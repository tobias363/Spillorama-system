var Sys = require('../../Boot/Sys');
const redisClient = require('../../Config/Redis');
var bcrypt = require('bcryptjs');
const moment = require('moment');
const mongoose = require('mongoose');
var back = require('express-back');
const { func } = require('joi');
var ETICKETCOLORS = [
    'Small White', 'Large White', 'Small Yellow', 'Large Yellow', 'Small Purple',
    'Large Purple', 'Small Blue', 'Large Blue'
];
var dateFormat = require('dateformat');
module.exports = {

    generateTicket: async function (req, res) {
        try {
            let data = req.body;
            console.log("++++++++++++++ req.body +++++++++++++++ : ", data)
            console.log("+++++++++++++++++++++++++++++++++++++++++++ : ")

            // generate physical ticket
            console.log("generate physical ticket", data.physicalTicketGameId)

            if (data.phyTicketpurchaseType == "byPhysicalTicketId") {
                let isAgentTicket = false;
                let agentIds = '';
                console.log("req.session.details.id : ", req.session.details)
                if (req.session.details.is_admin == "no" && req.session.details.role == 'agent') {
                    isAgentTicket = true;
                    agentIds = req.session.details.id;
                }
                let ticketData = {
                    playerType: 'Physical',
                    playerTicketType: 'Physical',
                    playerId: mongoose.Types.ObjectId(),
                    gameId: data.physicalTicketGameId1, //data.physicalTicketGameId,
                    purchaseType: 'realMoney',
                    voucherCode: '',
                    purchasedTickets: '{"list":[{"ticketType": "' + data.ticketcolor1 + '","ticketQty":1}]}',
                    isAgentTicket: isAgentTicket,
                    agentId: agentIds,
                    staticTicketId: data.physicalUniqueTicketId
                }
                let socket = { id: "6049f8e0e9d3164601de71e1" };
                console.log("data & socket", ticketData, socket)
                let generatedTicket = await Sys.Game.Game1.Controllers.GameController.PurchaseGame1PhysicalTickets(socket, ticketData)
                console.log("generatedTicket----", generatedTicket)
                if (generatedTicket.status == "fail") {
                    return res.send({ status: false, message: generatedTicket.message });
                }

                if (generatedTicket.status == "success") {
                    let generatedCode = generatedTicket.result.tickets;
                    console.log("generatedTicket.result.tickets", generatedTicket.result.tickets);
                    let mainObj = [];
                    let obj = [];
                    for (let i = 1; i <= (generatedCode.length); i++) {
                        if ((i * 1) % 5 == 0) {
                            obj.push(generatedCode[i - 1]);
                            mainObj.push({ rows: obj });
                            obj = [];
                        } else {
                            obj.push(generatedCode[i - 1]);
                        }

                    }
                    console.log(" main main main : ", mainObj)
                    return res.send({ status: true, message: 'done', result: { ticketCode: mainObj, ticketId: generatedTicket.result.ticketId } });
                }
            } else {
                let player = await Sys.App.Services.uniqueServices.getSinglePlayerData({ userType: 'Unique', username: data.physicalUniqueId }, ['_id', 'username', 'agentId', 'status', 'uniqueExpiryDate', 'userType', 'isCreatedByAdmin', 'createrId']);
                if (player) {

                    if (player.status != 'active') {
                        return res.send({ status: false, message: "This UniqueId is Blocked." });
                    }
                    console.log(" player player : ", player, " req.session.details.id : " + req.session.details.id)
                    if (req.session.details && req.session.details.role == 'agent') {
                        //if((!player.isCreatedByAdmin) && req.session.details && (player.agentId !=req.session.details.id)){
                        if (player.userType == "Unique" && req.session.details && (player.agentId != req.session.details.id)) {
                            return res.send({ status: false, message: "This UniqueId is not belogs with this agent." });
                        }
                    }


                    console.log("player uniqueExpiryDate", player.uniqueExpiryDate, new Date())
                    if (player.uniqueExpiryDate <= new Date()) {
                        return res.send({ status: false, message: "Your Unique Id is Expired, please Contact Administrator." });
                    }

                    // check for game time and unique id expired time
                    let newRoom = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.physicalTicketGameId }, { startDate: 1 });
                    console.log("unique id new Game timing", newRoom[0].startDate, player.uniqueExpiryDate, new Date())
                    if (player.uniqueExpiryDate <= newRoom[0].startDate) {
                        console.log("Your Unique will be Expired before starting the game, please Contact Administrator.")
                        return res.send({ status: false, message: "Your Unique Id will be Expired before starting of the game, please Contact Administrator." });
                    }

                    if (player.userType == "Unique" && player.isCreatedByAdmin == false) {
                        console.log("Unique userType with agent creator, so need to check for hall admin panel");
                        let agentHalls = await Sys.App.Services.HallServices.getAllHallDataSelect({ agents: { $elemMatch: { _id: player.createrId } } }, { name: 1 });
                        console.log("agent halls", agentHalls)

                        if (agentHalls.length > 0) {
                            let playerHalls = [];
                            for (let p = 0; p < agentHalls.length; p++) {
                                playerHalls.push(agentHalls[p]._id.toString());
                            }
                            let gameData = await Sys.Game.Game2.Services.GameServices.getSingleGameByData({ _id: data.physicalTicketGameId, status: 'active' }, {allHallsId: 1});

                            if (gameData) {
                                let gameHalls = gameData.allHallsId.map(function (item) {
                                    return item.toString();
                                });
                                // console.log("+++++++gameData Hall",gameHalls)
                                // return false;
                                const isHallmatched = playerHalls.some(r => gameHalls.includes(r));
                                console.log("isHallmatched", isHallmatched)
                                if (isHallmatched == false) {
                                    return res.send({ status: false, message: "You are not allowed to play in this hall." });
                                }
                            } else {
                                return res.send({ status: false, message: "Something went wrong." });
                            }

                        } else {
                            return res.send({ status: false, message: "You are not allowed to play in this hall." });
                        }

                    }
                    let isAgentTicket = false;
                    let agentIds = '';
                    if (!player.isCreatedByAdmin) {
                        isAgentTicket = true;
                        agentIds = player.agentId;
                    }

                    console.log(" isAgentTicket isAgentTicket : " + isAgentTicket + " agentIds agentIds :  " + agentIds)

                    console.log("req.session.details.id : ", req.session.details)

                    let ticketData = {
                        playerType: 'Unique',
                        playerTicketType: 'Physical',
                        playerId: player.id,
                        gameId: data.physicalTicketGameId, //data.physicalTicketGameId,
                        purchaseType: 'realMoney',
                        voucherCode: '',
                        purchasedTickets: '{"list":[{"ticketType": "' + data.ticketcolor + '","ticketQty":1}]}',
                        isAgentTicket: isAgentTicket,
                        agentId: agentIds
                    }
                    let socket = { id: "6049f8e0e9d3164601de71e1" };
                    console.log("data & socket", ticketData, socket)
                    let generatedTicket = await Sys.Game.Game1.Controllers.GameController.PurchaseGame1Tickets(socket, ticketData)
                    console.log("generatedTicket----", generatedTicket)
                    if (generatedTicket.status == "fail") {
                        return res.send({ status: false, message: generatedTicket.message });
                    }

                    if (generatedTicket.status == "success") {
                        let generatedCode = generatedTicket.result.tickets;
                        console.log("generatedTicket.result.tickets", generatedTicket.result.tickets);
                        let mainObj = [];
                        let obj = [];
                        for (let i = 1; i <= (generatedCode.length); i++) {
                            if ((i * 1) % 5 == 0) {
                                obj.push(generatedCode[i - 1]);
                                mainObj.push({ rows: obj });
                                obj = [];
                            } else {
                                obj.push(generatedCode[i - 1]);
                            }

                        }
                        console.log(" main main main : ", mainObj)
                        return res.send({ status: true, message: 'done', result: { ticketCode: mainObj, ticketId: generatedTicket.result.ticketId } });
                    }
                    //console.log("generated ticket result", generatedTicket)

                    // let ticketLargeArr=[{
                    //     insertOne: {
                    //         document: {
                    //                 "isPurchased":true,
                    //                 "gameId": data.physicalTicketGameId,
                    //                 "ticketColorType" : data.ticketcolor,
                    //                 "ticketColorName" : "Elvis 1",
                    //                 "ticketPrice": data.ticketprice,
                    //                 "isPlayerWon" :false,
                    //                 "isTicketSubmitted":false,
                    //                 "playerNameOfPurchaser":'usarray',
                    //                 "isWonByFullhouse":false,
                    //                 "userType":"Unique",
                    //                 "ticketPurchasedFrom":"realMoney",
                    //                 "wofWinners" : [],
                    //                 "tChestWinners" : [],
                    //                 "mystryWinners" : [],
                    //                 "gameType" : "game_1",
                    //                 "gameName":'',
                    //                 "ticketId": data.physicalUniqueId,
                    //                 "playerIdOfPurchaser":"",
                    //                 "supplier": "AIS",
                    //                 "developer":"AIS_Developer",

                    //         }
                    // }}]

                    // let ticketInsert = await Sys.App.Services.GameService.bulkWriteTicketData(ticketLargeArr);



                    // console.log(" are you there ________________",ticketInsert)
                    // let generatedCode = ["4","23","36","48","66","10","18","43","57","73","1","26",0,"53","62","11","29","37","46","74","3","17","38","50","64"];
                    // let mainObj=[];
                    // let obj=[];
                    // for(let i=0;i<(generatedCode.length);i++){
                    //     if((i*1+1)%6==0){
                    //         mainObj.push({rows:obj});
                    //         obj=[];
                    //     }else{
                    //         obj.push(generatedCode[i]);
                    //     }

                    // }
                    // console.log(" main main main : ",mainObj)

                    // return res.send({status:true,message:'done',result:{ticketCode:mainObj}});

                } else {
                    return res.send({ status: false, message: 'Player Not found for provided unique Id' });
                }
            }

        } catch (err) {
            return res.send({ status: false, message: err['message'] });
        }
    },
    generateEditTicket: async function (req, res) {
        try {
            let data = req.body;
            console.log("++++++++++++++ req.body +++++++++++++++ : ", data)
            console.log("+++++++++++++++++++++++++++++++++++++++++++ : ")

            let ticketAvail = await Sys.App.Services.GameService.getByIdTicket(data.ticketUniqueId);
            console.log("--ticketAvail--", ticketAvail)
            if (!ticketAvail) {
                return res.send({ status: false, message: "This edit ticket is invalid" });
            }
            // generate physical ticket
            console.log("generate physical ticket", data.physicalTicketGameId)

            if (data.physicalUniqueTicketId) {
                console.log("physicalUniqueTicketId new flow")
                let isAgentTicket = false;
                let agentIds = '';
                console.log("req.session.details.id : ", req.session.details)
                if (req.session.details.is_admin == "no" && req.session.details.role == 'agent') {
                    isAgentTicket = true;
                    agentIds = req.session.details.id;
                }
                let ticketData = {
                    playerType: 'Physical',
                    playerTicketType: 'Physical',
                    playerId: mongoose.Types.ObjectId(),
                    gameId: data.physicalTicketGameId, //data.physicalTicketGameId,
                    purchaseType: 'realMoney',
                    voucherCode: '',
                    purchasedTickets: '{"list":[{"ticketType": "' + data.ticketcolor + '","ticketQty":1}]}',
                    isAgentTicket: isAgentTicket,
                    agentId: agentIds,
                    staticTicketId: data.physicalUniqueTicketId
                }
                let socket = { id: "6049f8e0e9d3164601de71e1" };
                console.log("data & socket", ticketData, socket)
                let generatedTicket = await Sys.Game.Game1.Controllers.GameController.PurchaseGame1PhysicalTickets(socket, ticketData)
                console.log("generatedTicket----", generatedTicket)
                if (generatedTicket.status == "fail") {
                    return res.send({ status: false, message: generatedTicket.message });
                }

                if (generatedTicket.status == "success") {
                    let dataObj = {
                        gameId: data.physicalTicketGameId,
                        ticketId: ticketAvail._id,
                        playerId: ticketAvail.playerIdOfPurchaser,
                        updateStaticTicket: false,
                    }
                    let ress = await Sys.App.Controllers.UniqueIdController.cancelGameTickets(dataObj);
                    console.log(" res res cancelGameTickets cancelGameTickets : ", ress)
                    let generatedCode = generatedTicket.result.tickets;
                    console.log("generatedTicket.result.tickets", generatedTicket.result.tickets);
                    let mainObj = [];
                    let obj = [];
                    for (let i = 1; i <= (generatedCode.length); i++) {
                        if ((i * 1) % 5 == 0) {
                            obj.push(generatedCode[i - 1]);
                            mainObj.push({ rows: obj });
                            obj = [];
                        } else {
                            obj.push(generatedCode[i - 1]);
                        }

                    }
                    console.log(" main main main : ", mainObj)
                    return res.send({ status: true, message: 'done', result: { ticketCode: mainObj, ticketId: generatedTicket.result.ticketId } });
                }
            } else {
                let player = await Sys.App.Services.uniqueServices.getSinglePlayerData({ userType: 'Unique', username: data.physicalUniqueId }, ['_id', 'username', 'status', 'uniqueExpiryDate', 'userType', 'isCreatedByAdmin', 'createrId']);
                if (player) {

                    if (player.status != 'active') {
                        return res.send({ status: false, message: "This UniqueId is Blocked." });
                    }
                    console.log("player uniqueExpiryDate", player.uniqueExpiryDate, new Date())
                    if (player.uniqueExpiryDate <= new Date()) {
                        return res.send({ status: false, message: "Your Unique Id is Expired, please Contact Administrator." });
                    }

                    if (player.userType == "Unique" && player.isCreatedByAdmin == false) {
                        console.log("Unique userType with agent creator, so need to check for hall admin panel");
                        let agentHalls = await Sys.App.Services.HallServices.getAllHallDataSelect({ agents: { $elemMatch: { _id: player.createrId } } }, { name: 1 });
                        console.log("agent halls", agentHalls)
                        if (agentHalls.length > 0) {
                            let playerHalls = [];
                            for (let p = 0; p < agentHalls.length; p++) {
                                playerHalls.push(agentHalls[p]._id.toString());
                            }
                            let gameData = await Sys.Game.Game2.Services.GameServices.getSingleGameByData({ _id: data.physicalTicketGameId, status: 'active' }, {allHallsId: 1});
                            if (gameData) {
                                let gameHalls = gameData.allHallsId.map(function (item) {
                                    return item.toString();
                                });
                                const isHallmatched = playerHalls.some(r => gameHalls.includes(r));
                                console.log("isHallmatched", isHallmatched)
                                if (isHallmatched == false) {
                                    return res.send({ status: false, message: "You are not allowed to play in this hall." });
                                }
                            } else {
                                return res.send({ status: false, message: "Something went wrong." });
                            }

                        } else {
                            return res.send({ status: false, message: "You are not allowed to play in this hall." });
                        }

                    }

                    let isAgentTicket = false;
                    let agentIds = '';
                    if (req.session.details && req.session.details.role == 'agent') {
                        isAgentTicket = true;
                        agentIds = req.session.details.id;
                    }

                    let ticketData = {
                        playerType: 'Unique',
                        playerTicketType: 'Physical',
                        playerId: player.id,
                        gameId: data.physicalTicketGameId, //data.physicalTicketGameId,
                        purchaseType: 'realMoney',
                        voucherCode: '',
                        purchasedTickets: '{"list":[{"ticketType": "' + data.ticketcolor + '","ticketQty":1}]}',
                        isAgentTicket: isAgentTicket,
                        agentId: agentIds
                    }
                    let socket = { id: "6049f8e0e9d3164601de71e1" };
                    console.log("data & socket", ticketData, socket)
                    let generatedTicket = await Sys.Game.Game1.Controllers.GameController.PurchaseGame1Tickets(socket, ticketData)
                    console.log("generatedTicket----", generatedTicket)
                    if (generatedTicket.status == "fail") {
                        return res.send({ status: false, message: generatedTicket.message });
                    }

                    if (generatedTicket.status == "success") {
                        /**
                         * @ previous ticket cancel
                         */
                        let dataObj = {
                            gameId: data.physicalTicketGameId,
                            ticketId: ticketAvail._id,
                            playerId: ticketAvail.playerIdOfPurchaser,
                            updateStaticTicket: true,
                        }
                        let ress = await Sys.App.Controllers.UniqueIdController.cancelGameTickets(dataObj);
                        console.log(" res res cancelGameTickets cancelGameTickets : ", ress)

                        /**
                         * @end
                         */

                        let generatedCode = generatedTicket.result.tickets;
                        console.log("generatedTicket.result.tickets", generatedTicket.result.tickets);
                        let mainObj = [];
                        let obj = [];
                        for (let i = 1; i <= (generatedCode.length); i++) {
                            if ((i * 1) % 5 == 0) {
                                obj.push(generatedCode[i - 1]);
                                mainObj.push({ rows: obj });
                                obj = [];
                            } else {
                                obj.push(generatedCode[i - 1]);
                            }

                        }
                        console.log(" main main main : ", mainObj)
                        return res.send({ status: true, message: 'done', result: { ticketCode: mainObj, ticketId: generatedTicket.result.ticketId } });
                    }


                } else {
                    return res.send({ status: false, message: 'Player Not found for provided unique Id' });
                }
            }


        } catch (err) {
            return res.send({ status: false, message: err['message'] });
        }
    },

    cancelGameTickets: async function (data) {
        try {
            console.log("data in cancelGame Tickets", data)
            let gameData = await Sys.Game.Game2.Services.GameServices.getSingleGameByData({ _id: data.gameId }, {purchasedTickets: 1});
            if (gameData === null) {
                return {
                    status: 'fail',
                    result: null,
                    message: 'Game data is not found',
                }
            }
            let allPurchasedTickets = gameData.purchasedTickets;
            let ticketId = await Sys.Helper.bingo.obId(data.ticketId);
            let playerId = await Sys.Helper.bingo.obId(data.playerId);

            let updateGame = await Sys.Game.Game3.Services.GameServices.updateSingleGame({ _id: gameData._id }, { $pull: { purchasedTickets: { ticketId: ticketId } } }, { new: true }); //players: { id: playerId },

            console.log("+++++ticketId++++" + ticketId + "++++updateGame ++++++++++ updateGame ++++++ cancelGameTickets ++++++ :", updateGame)

            if (updateGame instanceof Error) {
                console.log("error in cancelling ticket");
                return { status: 'fail', result: null, message: 'Something went wrong while cancelling Tickets!', statusCode: 500 }
            }
            //let ticketCount = 0;
            let ticketIdArray = [];
            let ticketColorType = [];
            const playersTickets = allPurchasedTickets.filter((x) => { return JSON.stringify(x.ticketId) == JSON.stringify(ticketId) });
            console.log("playersTickets---", playersTickets.length);

            let ticketNumber = [];
            for (var i = 0; i < playersTickets.length; i++) {
                if (JSON.stringify(playersTickets[i].ticketId) == JSON.stringify(ticketId)) {

                    ticketIdArray.push(playersTickets[i].ticketParentId)
                    ticketColorType.push(playersTickets[i].ticketColorType)
                    ticketNumber.push(playersTickets[i].ticketNumber);
                }

            }
            console.log("ticketIdArray", ticketIdArray);
            console.log("ticketColorType", ticketColorType);
            let purchasedTickets = Object.values(ticketColorType.reduce((c, v) => {
                c[v] = c[v] || [v, 0];
                c[v][1]++;
                return c;
            }, {})).map(o => ({
                [o[0]]: o[1]
            }));

            console.log("purchasedTickets", purchasedTickets);
            for (let c = 0; c < purchasedTickets.length; c++) {
                let ticketType = Object.keys(purchasedTickets[c])[0];
                if (ticketType) {
                    console.log("ticketType", ticketType, purchasedTickets[c][ticketType])
                    let upData = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId }, {
                        $inc: { 'subGames.$[].options.$[o].totalPurchasedTickets': -(parseInt(purchasedTickets[c][ticketType])) }
                    }, { arrayFilters: [{ "o.ticketType": ticketType }], new: true });
                }
            }
            if (ticketIdArray.length > 0 && data.updateStaticTicket == true) {
                const duplicatecount = allPurchasedTickets.filter((x) => { return JSON.stringify(x.ticketNumber) == JSON.stringify(ticketNumber[0]) });
                console.log("duplicatecount---", duplicatecount.length);
                if (duplicatecount.length <= 1) {
                    Sys.Game.Game1.Services.GameServices.updateManyStaticData({ _id: { $in: ticketIdArray }, isPurchased: true }, { isPurchased: false, playerIdOfPurchaser: "" });
                }

            }

            // extra transaction

            let newPointArr = [];
            let newRealArr = [];
            for (let o = 0; o < playersTickets.length; o++) {
                if (playersTickets[o].purchasedSlug == "points") {
                    newPointArr.push(playersTickets[o]);
                } else {
                    newRealArr.push(playersTickets[o]);
                }
            }
            console.log("Total of ownPurchasedTicket Amount [ Game 2 Cancel Points ] ::--->> ", newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0))
            console.log("Total of ownPurchasedTicket Amount [ Game 2 Cancel Real ] ::--->> ", newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

            if (newPointArr.length > 0) {
                await Sys.Game.Game3.Services.GameServices.updateSingleGame({ _id: data.gameId }, { $inc: { earnedFromTickets: -newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0), finalGameProfitAmount: -newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0) } });
                await Sys.Game.Game1.Services.PlayerServices.update({ _id: playerId }, { $inc: { points: newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0) } });
            }

            if (newRealArr.length > 0) {
                await Sys.Game.Game3.Services.GameServices.updateSingleGame({ _id: data.gameId }, { $inc: { earnedFromTickets: -newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0), finalGameProfitAmount: -newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0) } });
                await Sys.Game.Game1.Services.PlayerServices.update({ _id: playerId }, { $inc: { walletAmount: newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0) } });
            }
            Sys.Game.Game3.Services.GameServices.updateSingleGame({ _id: data.gameId }, { $inc: { ticketSold: -playersTickets.length } });

            Sys.App.Services.GameService.deleteTicketManydata({ _id: data.ticketId });

            console.log("This Player [ ", " ] Ticket Cancellation Successfully..!!");




            return {
                status: 'success',
                result: '',
                message: 'Ticket cancellation successfully...!!!'
            }

        } catch (error) {
            console.log("Error cancelGameTickets", error);
        }
    },

    checkUniqueId: async function (req, res) {
        try {
            let uid = (req.body.uniqueId).trim();
            let player = await Sys.App.Services.uniqueServices.getSinglePlayerData({ userType: 'Unique', username: uid }, ['_id', 'username', 'uniquePurchaseDate', 'uniqueExpiryDate', 'walletAmount', 'hoursValidity']);
            if (!player) {
                return res.send({ status: false, message: 'Please enter valid unique id' });
            }
            if (player.status == false) {
                return res.send({ status: false, message: 'This unique id is Inactive' });
            }

            return res.send({ status: true, message: 'Done', result: { data: player } });


        } catch (err) {
            console.log("+++++++checkUniqueId++++++++:", err)
            return res.send({ status: false, message: err['message'] });
        }
    },
    uniqueId: async function (req, res) {
        try {
            let viewFlag = true;
            let addFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Unique ID Modules'] || [];
                let stringReplace =req.session.details.isPermission['Unique ID Modules'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }

                if (stringReplace?.indexOf("view") == -1) {
                    viewFlag = false;
                }
                if (stringReplace?.indexOf("add") == -1) {
                    addFlag = false;
                }
            }
            let halls = await Sys.App.Services.HallServices.getByData(
                {
                    "status": "active",
                    "agents.id": {
                        $exists: true
                    }
                }
            );
            const keys = [
                "unique_id_table",
                "dashboard",
                "generate_unique_id",
                "unique_id_purchase_date",
                "generate_expiry_date",
                "balance_amount",
                "select_hall",
                "select_agent",
                "payment_type",
                "select_payment_type",
                "online",
                "cash",
                "hours_validity",
                "print",
                "cancel",
                "unique_purchase_date",
                "unique_expiry_date",
                "select_halls",
                "error"
              ];
            let unique = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                halls: halls,
                uniqueMenu: 'active',
                uniqueAdd: 'active',
                addFlag: addFlag,
                unique: unique,
                navigation: unique
            };
            return res.render('unique/add', data);
        } catch (e) {
            console.log("Error", e);
            return res.render('/uniqueIdList');
        }
    },

    addUniqueId: async function (req, res) {
        try {
            console.log(" submitted for data addUniqueId addUniqueId : ", req.body, req.ip);
            // let purchaseDate = moment.utc(req.body.uipd_unique).toDate();
            // let endDate = moment.utc(req.body.uied_unique).toDate();
            let hall;
            if (req.session.details.role == "admin") {
                hall = await Sys.App.Services.HallServices.getSingleHall({ "_id": req.body.hall });
                console.log("hall result 1", hall);
            } else {
                let ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
                console.log("req.headers['x-forwarded-for']", req.headers['x-forwarded-for']);
                console.log('req.connection.remoteAddress', req.connection.remoteAddress);
                if (ipAddress.indexOf(',')) {
                    ipAddress = ipAddress.split(',');
                    ipAddress = ipAddress[0];
                }
                console.log("first ip", ipAddress);
                if (ipAddress.substr(0, 7) == "::ffff:") {
                    ipAddress = ipAddress.substr(7);
                }
                
                console.log("final ip", ipAddress);
                hall = await Sys.App.Services.HallServices.getSingleHall({ ip: ipAddress, status: "active", agents: { "$not": { "$size": 0 } } });
                console.log("hall result 2", hall);
            }
            if (!hall) {
                let uniqueTrans = await Sys.Helper.bingo.getTraslateData(["there_are_no_halls_available_to_assign"], req.session.details.language);
                return res.send({ status: false, message: uniqueTrans.there_are_no_halls_available_to_assign });
            }
            let tzone = req.body.ctimezone;

            //console.log(" local area time zone data : ",ok)
            var purchaseDate = moment.tz(req.body.uipd_unique, tzone);
            purchaseDate = purchaseDate.utc().toDate();

            var endDate = moment.tz(req.body.uied_unique, tzone);
            endDate = endDate.utc().toDate();

            let balance = req.body.balance_amount;
            let hoursValidity = req.body.unique_validity;

            // let player = await Sys.App.Services.uniqueServices.getSinglePlayerData({ userType: 'Unique' }, ['_id', 'username']);
            // console.log(" player player player player : ", player)
            // let uniqueId = (11111);
            // if (player && player.username) {
            //     uniqueId = ((player.username * 1) + 1);
            // }
            let uniqueId = Math.floor(Math.random() * (999999999 - 1) + 1);
            checkUniqueId(uniqueId)
            async function checkUniqueId(uniqueId) {
                let player = await Sys.App.Services.uniqueServices.getSinglePlayerData({ uniqueId : uniqueId})
                if (player) {
                    uniqueId = Math.floor(Math.random() * (999999999 - 1) + 1);
                    checkUniqueId(uniqueId)
                }
            }

            let hallData = {};
            let approvedHalls = [];
            let playerAgent = {};
            let hallApprovedBy = {};
            let shiftId = "";
            if (req.session.details.role == 'admin') {
            
                if (!hall.activeAgents || hall.activeAgents.length === 0 || hall.activeAgents[0].id !== req.body.agentId) {
                    let uniqueTrans = await Sys.Helper.bingo.getTraslateData(["selected_agent_not_active_or_previous_need_logout"], req.session.details.language);
                    return res.json({ status: false, message: uniqueTrans.selected_agent_not_active_or_previous_need_logout });
                }

                let agent =  {
                    id: hall.agents[0].id.toString(),
                    name: hall.agents[0].name
                }
                if(hall.agents && hall.agents.length > 0){
                    let agentIndex = hall.agents.findIndex((e) => e.id.toString() == req.body.agentId); 
                    if(agentIndex >= 0){
                        agent = {
                            id: hall.agents[agentIndex].id.toString(),
                            name: hall.agents[agentIndex].name
                        }
                    }
                }
                hallData = {
                    id: hall.id.toString(),
                    name: hall.name,
                    //agent: agent,
                    status: 'Approved',
                    // actionBy: {
                    //     id: req.session.details.id.toString(),
                    //     name: req.session.details.name,
                    //     role: req.session.details.role
                    // }
                }
                balance = 0;
                shiftId = hall.activeAgents[0].shiftId;
                approvedHalls.push({
                    id: hall.id.toString(),
                    name: hall.name,
                    status: 'Approved',
                    groupHall: hall.groupHall,
                });
                playerAgent = agent;
                hallApprovedBy = agent;
            } else {
                hallData = {
                    id: hall.id.toString(),
                    name: hall.name,
                    // agent: {
                    //     id: req.session.details.id.toString(),
                    //     name: req.session.details.name,
                    // },
                    status: 'Approved',
                    // actionBy: {
                    //     id: req.session.details.id.toString(),
                    //     name: req.session.details.name,
                    //     role: req.session.details.role
                    // }
                }
                balance = 0;
                if(hall && hall.activeAgents && hall.activeAgents.length > 0){
                    if( hall.activeAgents[0].id != req.session.details.id.toString() ){
                        let uniqueTrans = await Sys.Helper.bingo.getTraslateData(["ensure_preious_agent_logout"], req.session.details.language);
                        return res.send({ status: false, message: uniqueTrans.ensure_preious_agent_logout })
                    }
                }
                approvedHalls.push({
                    id: hall.id.toString(),
                    name: hall.name,
                    status: 'Approved',
                    groupHall: hall.groupHall,
                });
                playerAgent = {
                    id: req.session.details.id.toString(),
                    name: req.session.details.name,
                }
                hallApprovedBy = {
                    id: req.session.details.id.toString(),
                    name: req.session.details.name,
                }
            }
            const customer = await Sys.Game.Common.Controllers.PlayerController.generateUniqueCustomerNumber();
            let customerNumber;
            if(customer.status== "success" && customer.newCustomerNumber){
                customerNumber = customer.newCustomerNumber
            }else{
                let uniqueTrans = await Sys.Helper.bingo.getTraslateData(["language_update_failed"], req.session.details.language);
                return res.send({ status: false, message: uniqueTrans.language_update_failed})
            }
            let playerObj = {
                username: uniqueId,
                email: uniqueId + '@gmail.com',
                phone: uniqueId,
                bankId: uniqueId,
                name: uniqueId,
                surname: uniqueId,
                password: bcrypt.hashSync((uniqueId.toString()), 10),
                walletAmount: parseInt(balance),
                mobile: uniqueId,
                uniquePurchaseDate: purchaseDate,
                uniqueExpiryDate: endDate,
                hoursValidity: hoursValidity,
                userType: 'Unique',
                status: 'active',
                uniqueId: uniqueId,
                uniqueBalance: parseInt(balance),
                hall: hallData,
                groupHall: hall.groupHall,
                nickname: uniqueId,
                customerNumber: customerNumber,
                approvedHalls: approvedHalls,
                playerAgent: playerAgent,
                hallApprovedBy: hallApprovedBy
            };

            playerObj.isCreatedByAdmin = false;
            playerObj.agentId = req.session.details.id;
            if (req.session.details && req.session.details.role == 'admin') {
                playerObj.isCreatedByAdmin = true;
                playerObj.agentId = "";
            }
            playerObj.createrId = req.session.details.id;
            playerObj.uniquePaymentType = req.body.paymentType;

            let players = await Sys.App.Services.uniqueServices.insertPlayersData(playerObj);
            
            if (players) {
                let dailyBalance = null;
                if (req.session.details.role == 'agent') {
                    let response =  await Sys.App.Controllers.agentcashinoutController.addUniqueIdBalance({hall: hall.id, transactionType: "Create Unique Id by Agent", action: "add", isNew: true, amount: +parseInt(req.body.balance_amount), session: req.session, uniqueId: players.uniqueId, paymentType: (req.body.paymentType == "cash") ? "Cash": "Card"});
                    console.log("Response of add unique id", response);
                    dailyBalance = response.dailyBalance;
                    if (req.body.paymentType.toLowerCase() == 'cash') {
                        req.session.details.dailyBalance = Number(+dailyBalance);
                    }
                    players.walletAmount = response.userwallet;
                }else{

                    let transaction = {
                        playerId: players.id,
                        agentId: req.body.agentId,
                        hallId: hall.id,
                        amount: +parseInt(req.body.balance_amount),
                        paymentType: (req.body.paymentType == "cash") ? "Cash": "Card",
                        agentName: playerAgent.name, // hallData.agent.name,
                        operation:  "add",
                        action: "credit",
                        typeOfTransaction: "Create Unique Id by Admin",
                        hall: {
                            id: hallData.id,
                            name: hallData.name
                        },
                        groupHall: hall.groupHall,
                        userType: 'Unique'
                    }
                    try {
                        let response = await Sys.Helper.gameHelper.transferMoneyByHall(transaction);
                        if(response && response.status == "success"){
                            Sys.Helper.gameHelper.updateSession({agentId: req.body.agentId, hallId: hall.id, shiftId: shiftId})
                        }
                        
                    } catch (error) {
                        console.error('Error during transfer:', error);
                    }

                }

                return res.send({ status: true, message: 'Success', result: { data: players, dailyBalance: dailyBalance, paymentType: req.body.paymentType } });
            } else {
                let uniqueTrans = await Sys.Helper.bingo.getTraslateData(["language_update_failed"], req.session.details.language);
                return res.send({ status: false, message: uniqueTrans.language_update_failed })
            }


        } catch (e) {
            console.log("Error", e);
            return res.send({ status: false, message: e['message'], result: {} });
        }
    },
    uniqueIdList: async function (req, res) {
        try {
            let viewFlag = true;
            let withdrawFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Unique ID Modules'] || [];
                let stringReplace =req.session.details.isPermission['Unique ID Modules'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }

                if (stringReplace?.indexOf("view") == -1) {
                    viewFlag = false;
                }
                if (stringReplace?.indexOf("withdraw_username_uniqueId") == -1) {
                    withdrawFlag = false;
                }
                
            }
            let grpHalls = [];
            if (req.session.role == 'admin') {
                grpHalls = await Sys.App.Services.GroupHallServices.getByData({}, {
                    name: 1
                });
            }

            const keys = [
                "unique_id_table",
                "dashboard",
                "group_hall",
                "hall_name",
                "serach",
                "reset",
                "payment_type",
                "cash",
                "online",
                "unique_ticket_id",
                "group_of_hall",
                "created_by",
                "purchase_date_time",
                "expiry_date_time",
                "balance_amount_added",
                "status_of_unique_id",
                "withdraw_access",
                "action",
                "withdraw",
                "unique_id",
                "balance",
                "enter_balance",
                "search",
                "error",
                "start_date",
                "end_date",
                "show",
                "entries",
                "previous",
                "next",
                "transaction_history",
                "withdraw",
                "cancel",
                "amount_should_be_greater_than_zero",
                "agent_not_found"
              ];
            let unique = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                uniqueMenu: 'active',
                uniqueList: 'active',
                viewFlag: viewFlag,
                withdrawFlag: withdrawFlag,
                grpHalls: grpHalls,
                unique: unique,
                navigation: unique
            };
            return res.render('unique/uniqueList', data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    getUniqueList: async function (req, res) {
        try {

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            let grpHallId = req.query.groupHall;
            let hallId = req.query.hall;
            let paymentType = req.query.paymentType;
            console.log(" searching query ++++++++++++++++++++++++ : ", req.query)

            let fromDate = req.query.fromDate;
            let toDate = req.query.toDate;
            let status = req.query.status;

            let query = { userType: 'Unique' };
            if (grpHallId) {
                query[`groupHall.id`] = grpHallId;
            }
            if (hallId) {
                query[`hall.id`] = hallId;
            }
            if (req.session.details && req.session.details.role == 'agent') {
                // query.createrId=req.session.details.id;
                query[`hall.id`] = req.session.details.hall[0].id;
            }


            if (paymentType) {
                query.uniquePaymentType = paymentType
            }
            var current_date = new Date();

            // fromDate = moment.utc(req.query.fromDate).format();
            // toDate = moment.utc(req.query.toDate).format();

            console.log(" +++++++++++++++++ : " + current_date + " new record : " + new Date());

            if (status) {
                query['uniqueExpiryDate'] = ((status == 'active') ? { $gte: current_date } : { $lt: current_date });
            }

            // if(req.session.details && req.session.details.role=='agent'){
            //     query.isCreatedByAdmin=false;
            //     query.agentId=req.session.details.id;
            // }

            if (search != '') {
                query.username = { $regex: '.*' + search + '.*' };
            }

            if (fromDate) {
                fromDate = new Date(fromDate);
                fromDate.setHours(0, 0, 0, 0);
                var startOfToday = moment.tz(fromDate, "Asia/Calcutta");
                startOfToday = startOfToday.utc().toDate();
                console.log();
                query['uniquePurchaseDate'] = { $gte: startOfToday };

            }
            if (toDate) {
                toDate = new Date(toDate);
                toDate.setHours(23, 59, 59, 999);
                var endDate = moment.tz(toDate, "Asia/Calcutta");
                endDate = endDate.utc().toDate();

                if (query['uniquePurchaseDate']) {
                    query['uniquePurchaseDate']['$lt'] = endDate;
                } else {
                    query['uniquePurchaseDate'] = { $lt: endDate };
                }
            }

            console.log(" + from date + : " + fromDate + " +++++++++++++ : " + toDate)

            console.log(" query query getUniqueList  getUniqueList : ", query)

            let playersCount = await Sys.App.Services.uniqueServices.getPlayerCount(query);
            var data = await Sys.App.Services.uniqueServices.getPlayerData(query, length, start, { _id: -1 });

            let agentData = await Sys.App.Services.AgentServices.getPlayerDatatable({ "status": 'active' });
            let hallAgent = await Sys.App.Services.HallServices.getHallDatatable({ "status": "active" });
            console.log(" newHallAddAgent newHallAddAgent newHallAddAgent: ", hallAgent.length)

            for (let j = 0; j < (data.length); j++) {
                if (data[j].uniqueExpiryDate > Date.now()) {
                    data[j].expireStatus = "active";
                } else {
                    data[j].expireStatus = "inactive";
                }
            }

            console.log("unique id listing  : ", data.length)

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': playersCount,
                'recordsFiltered': playersCount,
                'data': data,
                'hallAgent': hallAgent,
                'agentData': agentData
            };


            return res.send(obj);

        } catch (e) {
            console.log("Error in getUniqueList", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': [],
                'hallAgent': hallAgent,
                'agentData': agentData
            });
        }
    },
    viewUniqueDetails: async function (req, res) {
        try {
            let id = req.params.id;
            let player = await Sys.App.Services.uniqueServices.getSinglePlayerData({ _id: id }, ['_id', 'username', 'hall', 'groupHall', 'uniquePurchaseDate', 'uniqueExpiryDate', 'walletAmount', 'hoursValidity', 'uniqueBalance', 'statisticsgame1', 'statisticsgame2', 'statisticsgame3', 'statisticsgame4', 'statisticsgame5', 'isCreatedByAdmin', 'createrId', 'status', 'uniquePaymentType']);
            let uniquePurchaseDate, uniqueExpiryDate;
            let uniquePurchaseDateP, uniqueExpiryDateP;
            let creator = {};
            if (player) {
                // uniquePurchaseDate=dateFormat(player.uniquePurchaseDate, "yyyy-mm-dd HH:MM:ss TT");
                // uniqueExpiryDate=dateFormat(player.uniqueExpiryDate, "yyyy-mm-dd HH:MM:ss TT");
                // uniquePurchaseDateP=dateFormat(player.uniquePurchaseDate, "dd/mm/yyyy HH:MM:ss TT");
                // uniqueExpiryDateP=dateFormat(player.uniqueExpiryDate, "dd/mm/yyyy HH:MM:ss TT");
                if (player.isCreatedByAdmin) {
                    creator = await Sys.App.Services.UserServices.getSingleUserData({ "_id": player.createrId }, { name: 1 });
                } else {
                    creator = await Sys.App.Services.AgentServices.getSingleUserData({ "_id": player.createrId }, { name: 1 });
                }
            }
            console.log(" player player player player : ", player)
            let totalWinnings = player.statisticsgame1.totalWinning + player.statisticsgame2.totalWinning + player.statisticsgame3.totalWinning + player.statisticsgame4.totalWinning + player.statisticsgame5.totalWinning;
            console.log("totalWinnings", totalWinnings)

            const keys = [
                "view_unique_id_table",
                "dashboard",
                "purchase_date",
                "expiry_date",
                "balance_amount",
                "hours_validity",
                "group_hall",
                "group_of_hall_name",
                "choose_game_type",
                "overall_winnings",
                "remaining_balance",
                "winning_pattern",
                "game_type",
                "game_variant",
                "ticket_price",
                "bet_amount",
                "game_id",
                "sub_game_id",
                "start_date_Time",
                "game_name",
                "ticket_purchased_from",
                "total_winnings",
                "spin_wheel_winnings",
                "treasure_chest_winnings",
                "mystry_winnings",
                "color_draft_winnings",
                "ticket_colour_type",
                "winning_amount",
                "Winning_row",
                "winnig_pattern",
                "winning_on_jackpot_number",
                "remark",
                "ticket_id",
                "jackpot_roulette_winning",
                "re_generate_unique_id",
                "hall_name",
                "serach",
                "reset",
                "payment_type",
                "cash",
                "online",
                "unique_ticket_id",
                "group_of_hall",
                "created_by",
                "purchase_date_time",
                "expiry_date_time",
                "balance_amount_added",
                "status_of_unique_id",
                "withdraw_access",
                "action",
                "withdraw",
                "unique_id",
                "balance",
                "enter_balance",
                "search",
                "error",
                "show",
                "entries",
                "previous",
                "next",
                "cancel",
            ];

            let unique = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                userData: player,
                uniquePurchaseDate: uniquePurchaseDate,
                uniqueExpiryDate: uniqueExpiryDate,
                uniquePurchaseDateP: uniquePurchaseDateP,
                uniqueExpiryDateP: uniqueExpiryDateP,
                createdBy: creator,
                Agent: req.session.details,
                totalWinnings: totalWinnings,
                unique: unique,
                navigation: unique
            }
            return res.render('unique/viewUniqueDetails', data);
            //res.send(player);
        } catch (e) {
            console.log("+++++++++++++++++viewUniqueDetails++++++++++++++ : ", e)
            return res.redirect('/uniqueIdList');
        }
    },
    viewSpaceficTicketDetails: async function (req, res) {
        try {

            //console.log("viewSpaceficTicketDetails +++++++++++++ : ", req.query)



            let order = req.query.order;
            let sort = {};
            if (order?.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1
                }
            }
            console.log("sort", sort, order);
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            // let search = req.query.search.value;

            let query = {
                uniquePlayerId: req.query.uniqueId,
                gameType: req.query.gameType
            };

            let gameData = [];

            let ticketsCount = 0;


            if (req.session.details && req.session.details.role == 'agent') {
                // query.isAgentTicket=true;
                // query.agentId=req.session.details.id;
                query.hallId = req.session.details.hall[0].id;
            }

            console.log("length, start, sort,query", length, start, sort, query)

            if(req.query.gameType == 'game_5' || req.query.gameType == 'game_4'){
                query.isPurchased = true;
            }

            ticketsCount = await Sys.App.Services.GameService.getTicketCount(query);
            let ticketInfo = await Sys.App.Services.GameService.getTicketDatatable(query, length, start, { gameStartDate: -1 });

            //console.log(" data data data -------------------: ", " ticketsCount: ", ticketsCount, " ticketInfo : ", ticketInfo);

            if (ticketInfo.length > 0) {
                if (req.query.gameType == 'game_1') {
                    for (let j = 0; j < ticketInfo.length; j++) {
                        let amount = 0;
                        if (ticketInfo[j].winningStats) {
                            amount += +ticketInfo[j].winningStats.finalWonAmount;
                        }


                        let winningPattern = ticketInfo[j].winningStats;
                        console.log("winningPattern", winningPattern);
                        if (winningPattern) {
                            if (ticketInfo[j].bonusWinningStats) {
                                if (ticketInfo[j].bonusWinningStats.wonAmount > 0) {
                                    amount += +ticketInfo[j].bonusWinningStats.wonAmount;
                                    winningPattern.lineTypeArray.push({ lineType: ticketInfo[j].bonusWinningStats.lineType, wonAmount: ticketInfo[j].bonusWinningStats.wonAmount })
                                }
                            }

                            if (ticketInfo[j].luckyNumberWinningStats) {
                                if (ticketInfo[j].luckyNumberWinningStats.wonAmount > 0) {
                                    amount += +ticketInfo[j].luckyNumberWinningStats.wonAmount;
                                    winningPattern.lineTypeArray.push({ lineType: ticketInfo[j].luckyNumberWinningStats.lineType, wonAmount: ticketInfo[j].luckyNumberWinningStats.wonAmount })
                                }
                            }

                        }

                        let wofWinners = 0;
                        if (ticketInfo[j].wofWinners && ticketInfo[j].wofWinners.length > 0) {
                            wofWinners = ticketInfo[j].wofWinners[0].WinningAmount;
                            // amount += +ticketInfo[j].wofWinners[0].WinningAmount;
                        }

                        let tChestWinners = 0;
                        if (ticketInfo[j].tChestWinners && ticketInfo[j].tChestWinners.length > 0) {
                            tChestWinners = ticketInfo[j].tChestWinners[0].WinningAmount;
                            // amount += +ticketInfo[j].tChestWinners[0].WinningAmount;
                        }

                        let mystryWinners = 0;
                        if (ticketInfo[j].mystryWinners && ticketInfo[j].mystryWinners.length > 0) {
                            mystryWinners = ticketInfo[j].mystryWinners[0].WinningAmount;
                            // amount += +ticketInfo[j].mystryWinners[0].WinningAmount;
                        }

                        let colorDraftWinners = 0;
                        if(ticketInfo[j].colorDraftWinners && ticketInfo[j].colorDraftWinners.length > 0){
                            colorDraftWinners = ticketInfo[j].colorDraftWinners[0].WinningAmount;
                        }

                        // if(ticketInfo[j].wofWinners && ticketInfo[j].wofWinners.length > 0){
                        //     winningPattern.lineTypeArray.push({ lineType: "Wheel of Fortune", wonAmount: ticketInfo[j].wofWinners[0].WinningAmount })
                        // }

                        // if(ticketInfo[j].tChestWinners && ticketInfo[j].tChestWinners.length > 0){
                        //      winningPattern.lineTypeArray.push({ lineType: "Treasure Chest", wonAmount: ticketInfo[j].tChestWinners[0].WinningAmount })
                        // }

                        // if(ticketInfo[j].mystryWinners && ticketInfo[j].mystryWinners.length > 0){
                        //     winningPattern.lineTypeArray.push({ lineType: "Mystry Game", wonAmount: ticketInfo[j].mystryWinners[0].WinningAmount })
                        // }

                        // function dateTimeFunction(dateData) {
                        //     let dt = new Date(dateData);
                        //     let date = dt.getDate();
                        //     let month = parseInt(dt.getMonth() + 1);
                        //     let year = dt.getFullYear();
                        //     let hours = dt.getHours();
                        //     let minutes = dt.getMinutes();
                        //     minutes = minutes < 10 ? '0' + minutes : minutes;
                        //     let dateTime = (year + '/' + month + '/' + date + ' ' + hours + ':' + minutes);
                        //     return dateTime; // Function returns the dateandtime
                        // }
                        // let gameStartDate = (ticketInfo[j].gameStartDate == null) ? '' : dateTimeFunction(ticketInfo[j].gameStartDate);

                        let dataGame = {
                            _id: ticketInfo[j]._id,
                            ticketId: ticketInfo[j].ticketId,
                            ticketPrice: ticketInfo[j].ticketPrice,
                            ticketPurchasedFrom: ticketInfo[j].ticketPurchasedFrom,
                            winnigPattern: winningPattern, //ticketInfo[j].winningStats, 
                            totalWinning: amount,
                            ticketColorType: ticketInfo[j].ticketColorType,
                            gameName: ticketInfo[j].gameName,
                            wofWinners: parseFloat(wofWinners),
                            tChestWinners: parseFloat(tChestWinners),
                            mystryWinners: parseFloat(mystryWinners),
                            colorDraftWinners: parseFloat(colorDraftWinners),
                            gameId: ticketInfo[j].gameId,
                            subGameId: ticketInfo[j].subGame1Id,
                            gameStartDate: ticketInfo[j].gameStartDate,
                            createdAt: ticketInfo[j].createdAt
                        }

                        gameData.push(dataGame);
                    }
                } else if (req.query.gameType == 'game_2') {
                    for (let j = 0; j < ticketInfo.length; j++) {
                        let amount = 0;
                        let remark = '-';
                        if (ticketInfo[j].winningStats) {
                            amount += +ticketInfo[j].winningStats.finalWonAmount;
                            winningLine = ticketInfo[j].winningStats.lineTypeArray;
                        }


                        let winningPattern = ticketInfo[j].winningStats;
                        if (winningPattern?.lineTypeArray) {
                            remark = winningPattern.lineTypeArray.reduce(function (result, item) {
                                return result + (result.length ? ',\n\n' : '') + item.remarks;
                            }, '');
                            if (ticketInfo[j].luckyNumberWinningStats) {
                                if (ticketInfo[j].luckyNumberWinningStats.wonAmount > 0) {
                                    amount += +ticketInfo[j].luckyNumberWinningStats.wonAmount;
                                }
                            }

                        }

                        // function dateTimeFunction(dateData) {
                        //     let dt = new Date(dateData);
                        //     let date = dt.getDate();
                        //     let month = parseInt(dt.getMonth() + 1);
                        //     let year = dt.getFullYear();
                        //     let hours = dt.getHours();
                        //     let minutes = dt.getMinutes();
                        //     minutes = minutes < 10 ? '0' + minutes : minutes;
                        //     let dateTime = (year + '/' + month + '/' + date + ' ' + hours + ':' + minutes);
                        //     return dateTime; // Function returns the dateandtime
                        // }
                        // let gameStartDate = (ticketInfo[j].gameStartDate == null) ? '' : dateTimeFunction(ticketInfo[j].gameStartDate);

                        let dataGame = {
                            _id: ticketInfo[j]._id,
                            ticketId: ticketInfo[j].ticketId,
                            ticketPrice: ticketInfo[j].ticketPrice,
                            ticketPurchasedFrom: ticketInfo[j].ticketPurchasedFrom,
                            winnigPattern: winningPattern ? winningPattern : "-", //ticketInfo[j].winningStats, 
                            totalWinning: ticketInfo[j].totalWinningOfTicket,
                            ticketColorType: ticketInfo[j].ticketColorType,
                            gameId: ticketInfo[j].parentGameId ? ticketInfo[j].parentGameId : '-',
                            subGameId: ticketInfo[j].gameId,
                            gameStartDate: ticketInfo[j].gameStartDate,
                            remark: remark,
                            createdAt: ticketInfo[j].createdAt
                        }
                        gameData.push(dataGame);
                    }
                } else if(req.query.gameType == 'game_4'){
                    for (let j = 0; j < ticketInfo.length; j++) {
                        let dataGame = {
                            _id: ticketInfo[j]._id,
                            ticketId: ticketInfo[j].ticketId,
                            ticketPrice: ticketInfo[j].ticketPrice,
                            ticketPurchasedFrom: ticketInfo[j].ticketPurchasedFrom,
                            winnigPattern: ticketInfo[j].winningStats, 
                            totalWinning: ticketInfo[j].totalWinningOfTicket,
                            extraWinnings: (ticketInfo[j].mystryWinners.length > 0) ? ticketInfo[j].mystryWinners[0].WinningAmount: 0,
                            ticketColorType: ticketInfo[j].ticketColorName,
                            gameId: ticketInfo[j].gameName ? ticketInfo[j].gameName : '-',
                            gameStartDate: ticketInfo[j].gameStartDate,
                            remark: "-",
                            createdAt: ticketInfo[j].createdAt
                        }
                        gameData.push(dataGame);
                    }
                } else if(req.query.gameType == 'game_5'){
                    for (let j = 0; j < ticketInfo.length; j++) {
                        let winningPattern = ticketInfo[j].winningStats;
                        let dataGame = {
                            _id: ticketInfo[j]._id,
                            ticketId: ticketInfo[j].ticketId,
                            ticketPrice: ticketInfo[j].ticketPrice,
                            ticketPurchasedFrom: ticketInfo[j].ticketPurchasedFrom,
                            winnigPattern: winningPattern, //ticketInfo[j].winningStats, 
                            totalWinning: ticketInfo[j].totalWinningOfTicket,
                            extraWinnings: (ticketInfo[j].bonusWinningStats) ? ticketInfo[j].bonusWinningStats.finalWonAmount: 0,
                            ticketColorType: ticketInfo[j].ticketColorName,
                            gameId: ticketInfo[j].gameName ? ticketInfo[j].gameName : '-',
                            gameStartDate: ticketInfo[j].gameStartDate,
                            remark: "-",
                            createdAt: ticketInfo[j].createdAt
                        }
                        gameData.push(dataGame);
                    }
                } else {
                    for (let j = 0; j < ticketInfo.length; j++) {
                        let amount = 0;
                        let remark = '-';
                        if (ticketInfo[j].winningStats) {
                            amount += +ticketInfo[j].winningStats.finalWonAmount;
                            winningLine = ticketInfo[j].winningStats.lineTypeArray;
                        }


                        let winningPattern = ticketInfo[j].winningStats;
                        console.log("winningPattern", winningPattern);
                        if (winningPattern?.lineTypeArray) {
                            remark = winningPattern.lineTypeArray.reduce(function (result, item) {
                                return result + (result.length ? ',\n\\' : '') + `Won ${item.wonAmount} for ${item.lineType} pattern.`;
                            }, '');
                            if (ticketInfo[j].luckyNumberWinningStats) {
                                if (ticketInfo[j].luckyNumberWinningStats.wonAmount > 0) {
                                    amount += +ticketInfo[j].luckyNumberWinningStats.wonAmount;
                                }
                            }

                        }
                        let dataGame = {
                            _id: ticketInfo[j]._id,
                            ticketId: ticketInfo[j].ticketId,
                            ticketPrice: ticketInfo[j].ticketPrice,
                            ticketPurchasedFrom: ticketInfo[j].ticketPurchasedFrom,
                            winnigPattern: winningPattern, //ticketInfo[j].winningStats, 
                            totalWinning: ticketInfo[j].totalWinningOfTicket,
                            ticketColorType: ticketInfo[j].ticketColorType,
                            gameId: ticketInfo[j].parentGameId ? ticketInfo[j].parentGameId : '-',
                            subGameId: ticketInfo[j].gameId,
                            gameStartDate: ticketInfo[j].gameStartDate,
                            remark: remark,
                            createdAt: ticketInfo[j].createdAt
                        }
                        gameData.push(dataGame);
                    }
                }
            }

            //console.log("gameData", dataGame)


            let obj = {
                'draw': req.query.draw,
                'recordsTotal': ticketsCount,
                'recordsFiltered': ticketsCount,
                'data': gameData
            };
            //console.log(" ++++++++++++++++ viewSpaceficTicketDetails +++++++++++++++  : ",obj)

            return res.send(obj);

        } catch (err) {
            console.log(" err in viewUniquePlayerTicket +++++++++++++++++++ : ", err)
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            };
            return res.send(obj);
        }
    },
    depositWithdraw: async function (req, res) {
        try {
            let data = req.body;
            let pid = data.pid;
            let amount = data.amount;

            if (data.type == 'withdraw') {
                let player = await Sys.App.Services.uniqueServices.getSinglePlayerData({ _id: pid }, ['_id', 'username', 'uniquePurchaseDate', 'uniqueExpiryDate', 'walletAmount']);
                if (!player) {
                    return res.send({ status: false, message: 'Player detail not found' });
                }
                if ((amount * 1) > (player.walletAmount * 1)) {
                    return res.send({ status: false, message: 'Withdraw amount need to be less' });
                }
                let pl = await Sys.App.Services.uniqueServices.updateUniquePlayerData({ _id: pid }, { $inc: { walletAmount: -(1 * amount), uniqueBalance: - (1 * amount) } });
                if (pl) {
                    let plr = await Sys.App.Services.uniqueServices.getSinglePlayerData({ _id: pid }, ['_id', 'username', 'uniquePurchaseDate', 'uniqueExpiryDate', 'walletAmount']);


                    let transactionDataSend = {
                        playerId: plr._id,
                        gameId: '',
                        ticketId: plr.username,
                        transactionSlug: "unique",
                        action: "debit", // debit / credit
                        purchasedSlug: 'realMoney', // point /realMoney
                        totalAmount: amount,
                        typeOfTransaction: "Withdraw",
                    }
                    //console.log("purchasedTickets & transactioons", gameDataTicket, transactionDataSend)
                    await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);
                    res.send({ status: true, message: 'Balance updated successfully', result: { data: plr } });

                } else {
                    return res.send({ status: false, message: 'Failed to update' });
                }

            } else {
                let pl = await Sys.App.Services.uniqueServices.updateUniquePlayerData({ _id: pid }, { $inc: { walletAmount: (1 * amount), uniqueBalance: (1 * amount) } });
                if (pl) {
                    let plr = await Sys.App.Services.uniqueServices.getSinglePlayerData({ _id: pid }, ['_id', 'username', 'uniquePurchaseDate', 'uniqueExpiryDate', 'walletAmount']);

                    let transactionDataSend = {
                        playerId: plr._id,
                        gameId: '',
                        ticketId: plr.username,
                        transactionSlug: "unique",
                        action: "credit", // debit / credit
                        purchasedSlug: 'realMoney', // point /realMoney
                        totalAmount: amount,
                        typeOfTransaction: "Deposit",
                    }
                    await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);

                    return res.send({ status: true, message: 'Balance updated successfully', result: { data: plr } });
                } else {
                    return res.send({ status: false, message: 'Failed to update' });
                }
            }
        } catch (err) {
            return res.send({ status: false, message: 'Somethings went wrongs please try again later' })
        }
    },

    // Unique player physical ticket
    physicalTicketManagement: async function (req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Physical Ticket Management'] || [];
                let stringReplace =req.session.details.isPermission['Physical Ticket Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }

                if (stringReplace?.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            const keysArray = [
                "physical_ticket_list",
                "dashboard",
                "search",
                "physical_ticket_number",
                "game1_variants_game",
                "ticket_type",
                "ticket_price",
                "Winning_row",
                "total_winning",
                "ticket_number",
                "start_date",
                "end_date",
                "show",
                "entries",
                "previous",
                "next",
              ]
                  
            let physical = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                physicalTicketManagement: 'active',
                physical: physical,
                navigation: physical
            };
            return res.render('unique/physicalTicketList', data);
        } catch (error) {
            Sys.Log.error('Error in gameType: ', error);
            return new Error(error);
        }
    },

    getPhysicalTicketList: async function (req, res) {
        try {
            let order = req.query.order;
            let sort = {};
            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1
                }
            }
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let query = { playerTicketType: "Physical" };
            if (search != '') {
                query = { ticketId: { $regex: '.*' + search + '.*' }, playerTicketType: "Physical" };
            }
            if (req.session.details && req.session.details.role == 'agent') {
                query.isAgentTicket = true;
                query.agentId = req.session.details.id;
            }

            let fromDate = req.query.fromDate;
            let toDate = req.query.toDate;

            if (fromDate) {
                var startOfToday = new Date(fromDate);
                startOfToday.setHours(0, 0, 0, 0);
                query['createdAt'] = { $gte: startOfToday };
            }
            if (toDate) {
                var endDate = new Date(toDate);
                endDate.setHours(23, 59, 59, 999);
                if (query['createdAt']) {
                    query['createdAt']['$lt'] = endDate;
                } else {
                    query['createdAt'] = { $lt: endDate };
                }
            }
            console.log("query", query)
           
            let reqCount = await Sys.App.Services.GameService.getTicketCount(query);
        
            let data = await Sys.App.Services.GameService.getTicketsByData(query, { ticketId: 1, gameName: 1, ticketColorName: 1, ticketPrice: 1, winningStats: 1, wofWinners: 1, tChestWinners: 1, mystryWinners: 1, totalWinningOfTicket: 1 }, { sort: sort, limit: length, skip: start });
            
            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };
            res.send(obj);
        } catch (e) {
            console.log("Error", e);
        }
    },

    withdrawAccess: async function (req, res) {
        try {
            console.log("req.body in withdrawAccess", req.body);
            let uniquePlayer = await Sys.App.Services.uniqueServices.getSinglePlayerData({ _id: new mongoose.Types.ObjectId(req.body.id) });
            if (uniquePlayer) {
                console.log("uniquePlayer Found");
                let flag = false;
                if (req.body.enable === "true") {
                    flag = true;
                }
                let update = await Sys.App.Services.uniqueServices.updateUniquePlayerData({ _id: uniquePlayer._id }, {
                    "$set": {
                        "withdrawEnabledUnique": flag
                    }
                });
                if (update) {
                    return res.send({ "status": "success" });
                } else {
                    return res.send({ "status": "fail" });
                }
            } else {
                return res.send({ "status": "fail" });
            }
        } catch (error) {
            console.log("Error in withdrawAccess API", error);
            return res.send({ "status": "fail" });
        }
    },

    transactions: async function(req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Unique ID Modules'] || [];
                let stringReplace =req.session.details.isPermission['Unique ID Modules'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // let stringReplace = req.session.details.isPermission['Unique ID Modules'];

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }

            const keys = [
                "transaction_history",
                "dashboard",
                "serach",
                "action",
                "search",
                "error",
                "start_date",
                "end_date",
                "from_date",
                "to_date",
                "show",
                "entries",
                "previous",
                "next",
                "order_number",
                "tranaction_id",
                "date_time",
                "tranaction_type",
                "amount",
                "status"
            ];

            let unique = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                uniqueMenu: 'active',
                uniqueList: 'active',
                playerId: req.params.id,
                unique: unique,
                navigation: unique
            };

            if (viewFlag == true) {
                return res.render('unique/transactions', data);
            } else {
                req.flash('error', 'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in depositTransaction", e);
            return new Error(e);
        }
    },

    getTransactions: async function(req, res) {
        try {
            console.log('get unique id transactions',req.query);
            let order = req.query.order;
            let sort = {};
            if (order?.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1,
                }
            }else{
                sort = {
                    _id : -1
                }
            }

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            let isDate = false;
            let createdAt = {};
            if(req.query.startdate != '' && req.query.enddate != ''){
                let startdate = moment(req.query.startdate).startOf('day');
                let enddate = moment(req.query.enddate).endOf('day');
                
                if (enddate < startdate) {
                    req.flash("error", "Please Select Proper Date Range");
                    let obj = {
                        'draw': 0,
                        'recordsTotal': 0,
                        'recordsFiltered': 0,
                        'data': [],
                    };
                    return res.send(obj);
                }
                const fromDate = new Date(startdate);
                const toDate = new Date(enddate);
                createdAt = {
                    $gte: fromDate,
                    $lte: toDate
                }
                isDate = true;
            }

            let query = {
                playerId: req.query.playerId, 
                $or: [{ defineSlug: "extraTransaction" }, { defineSlug: "patternPrizeGame1" }, { defineSlug: "jackpotPrizeGame1" }, { defineSlug: "WOFPrizeGame1" }, { defineSlug: "TChestPrizeGame1" }, { defineSlug: "mystryPrizeGame1" }, { defineSlug: "luckyNumberPrizeGame1" }, { defineSlug: "mysteryPrizeGame1" }, {defineSlug: "colordraftPrizeGame1"}, {defineSlug: "patternPrize"}],
                createdAt: createdAt
            };
           
            if (search != '') {
                query.transactionId = { $regex: '.*' + search + '.*', $options: 'i' }
            }
            console.log('query',query);
            let reqCount = await Sys.App.Services.transactionServices.getCount(query);
            let data = await Sys.Game.Common.Services.PlayerServices.getTransactionByData(query, { category: 1, typeOfTransaction: 1, typeOfTransactionTotalAmount: 1, transactionId: 1, amtCategory: 1, status: 1, createdAt: 1 }, { sort: sort, limit: length, skip: start });

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            return res.send(obj);
        } catch (e) {
            console.log("Error in getPlayerTransactions", e);
        }
    },
}