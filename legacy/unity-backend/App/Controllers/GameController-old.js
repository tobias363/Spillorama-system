var Sys = require('../../Boot/Sys');
const redisClient = require('../../Config/Redis');
var bcrypt = require('bcryptjs');
const moment = require('moment');
const mongoose = require('mongoose');
var back = require('express-back');
var ETICKETCOLORS = [
    'Small White', 'Large White', 'Small Yellow', 'Large Yellow', 'Small Purple',
    'Large Purple', 'Small Blue', 'Large Blue'
];
module.exports = {

    // [ Game Type ]
   

    gameType: async function(req, res) {
        try {
            let reqCount = await Sys.App.Services.GameService.getGameTypeCount();
            console.log('length: ', reqCount);

            reqCount = (reqCount >= 4) ? false : true;
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                reqCount: reqCount,
                gameTypeActive: 'active',
            };
            return res.render('gameType/list', data);
        } catch (error) {
            Sys.Log.error('Error in gameType: ', error);
            return new Error(error);
        }
    },

    getGameType: async function(req, res) {
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

            let query = {};
            if (search != '') {
                query = { name: { $regex: '.*' + search + '.*' } };
            }

            let reqCount = await Sys.App.Services.GameService.getGameTypeCount(query);

            let data = await Sys.App.Services.GameService.getGameTypeDatatable(query, length, start, sort);

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

    addGameType: async function(req, res) {
        try {
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                gameTypeActive: 'active',
                gameCount: await Sys.App.Services.GameService.getGameTypeCount() + 1
            };
            return res.render('gameType/add', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    addGameTypePostData: async function(req, res) {
        try {
            console.log('pattern: ', req.body);
            let fileName = '';
            if (req.files) {
                let image = req.files.avatar;
                var re = /(?:\.([^.]+))?$/;
                var ext = re.exec(image.name)[1];
                fileName = Date.now() + '.' + ext;
                // Use the mv() method to place the file somewhere on your server
                image.mv('./public/profile/bingo/' + fileName, async function(err) {
                    if (err) {
                        req.flash('error', 'Error Uploading Profile Avatar');
                        return res.redirect('/profile');
                    }
                    let pattern = (req.body.pattern == 'on') ? true : false;
                    var pickLuckyNumber = [];
                    if ((await Sys.App.Services.GameService.getGameTypeCount() + 1) == 1 || (await Sys.App.Services.GameService.getGameTypeCount() + 1) == 3) {;
                        pickLuckyNumber = [
                            '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
                            '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
                            '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
                            '31', '32', '33', '34', '35', '36', '37', '38', '39', '30',
                            '41', '42', '43', '44', '45', '46', '47', '48', '49', '50',
                            '51', '52', '53', '54', '55', '56', '57', '58', '59', '60',
                            '61', '62', '63', '64', '65', '66', '67', '68', '69', '70',
                            '71', '72', '73', '74', '75'
                        ];
                    } else if ((await Sys.App.Services.GameService.getGameTypeCount() + 1) == 2) {
                        pickLuckyNumber = [
                            '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11',
                            '12', '13', '14', '15', '16', '17', '18', '19', '20', '21'
                        ];
                    }

                    let game = await Sys.App.Services.GameService.insertGameTypeData({
                        createrId: req.session.details.id,
                        type: "game_" + (await Sys.App.Services.GameService.getGameTypeCount() + 1),
                        name: req.body.name,
                        row: req.body.row,
                        columns: req.body.columns,
                        photo: fileName,
                        pickLuckyNumber: pickLuckyNumber,
                        pattern: pattern,
                        // totalNoTickets: req.body.totalNoTickets,
                        // userMaxTickets: req.body.userMaxTickets,
                        rangeMin: req.body.rangeMin,
                        rangeMax: req.body.rangeMax,
                    });
                    req.flash('success', 'Game create successfully');
                    return res.redirect('/gameType');
                });
            } else {
                req.flash('error', 'Game Not Created');
                return res.redirect('/gameType');
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    editGameType: async function(req, res) {
        try {

            let query = { _id: req.params.id };
            let gameType = await Sys.App.Services.GameService.getGameTypeById(query);

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                gameTypeActive: 'active',
                gameType: gameType,
                gameCount: await Sys.App.Services.GameService.getGameTypeCount() + 1
            };
            return res.render('gameType/add', data);

        } catch (e) {
            console.log("Error", e);
        }
    },


    editGameTypePostData: async function(req, res) {
        try {
            let UpdateGameTwo = await Sys.App.Services.GameService.getGameTypeById({ _id: req.params.id });
            console.log('pattern: ', req.body);
            if (UpdateGameTwo != undefined) {
                let pattern = (req.body.pattern == 'on') ? true : false;
                if (req.files && req.files.avatar && req.files.avatar.name) {
                    let image = req.files.avatar;
                    var re = /(?:\.([^.]+))?$/;
                    var ext = re.exec(image.name)[1];
                    fileName = Date.now() + '.' + ext;
                    // Use the mv() method to place the file somewhere on your server
                    image.mv('./public/profile/bingo/' + fileName, async function(err) {
                        if (err) {
                            req.flash('error', 'Error Uploading Profile Avatar');
                            return res.redirect('/profile');
                        }
                        let game = await Sys.App.Services.GameService.updateOneGameType({
                            _id: req.params.id
                        }, {
                            //name: req.body.name,
                            row: req.body.row,
                            columns: req.body.columns,
                            photo: fileName,
                            pattern: pattern,
                            totalNoTickets: req.body.totalNoTickets,
                            userMaxTickets: req.body.userMaxTickets,
                            rangeMin: req.body.rangeMin,
                            rangeMax: req.body.rangeMax,
                        });
                        req.flash('success', 'Game Updated successfully');
                        return res.redirect('/gameType');
                    });
                } else {
                    let game = await Sys.App.Services.GameService.updateOneGameType({
                        _id: req.params.id
                    }, {
                        //name: req.body.name,
                        row: req.body.row,
                        columns: req.body.columns,
                        pattern: pattern,
                        totalNoTickets: req.body.totalNoTickets,
                        userMaxTickets: req.body.userMaxTickets,
                        rangeMin: req.body.rangeMin,
                        rangeMax: req.body.rangeMax,
                    });
                    req.flash('success', 'Game Updated successfully');
                    return res.redirect('/gameType');
                }
            } else {
                req.flash('error', 'No Game found');
                return res.redirect('/gameType');
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteGameType: async function(req, res) {
        try {
            let game = await Sys.App.Services.GameService.getSingleGameType({ _id: req.body.id });
            if (game || game.length > 0) {
                await Sys.App.Services.GameService.deleteGameType(req.body.id)
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    viewGameType: async function(req, res) {
        try {

            let query = { _id: req.params.id };
            let gameType = await Sys.App.Services.GameService.getGameTypeById(query);

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                gameTypeActive: 'active',
                gameType: gameType
            };
            return res.render('gameType/view', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    // [ New Documention wise ] Game Management DropDowm
    viweGameManagement: async function(req, res) {
        try {
            var gameType = await Sys.App.Services.GameService.getByDataSortGameType({});
            //let shiv = await redisClient.get('game3')
            //console.log("shiv", shiv);
            var gameData = [];
            var dataGame = {};
            for (var i = 0; i < gameType.length; i++) {
                dataGame = {
                    _id: gameType[i]._id,
                    name: gameType[i].name,
                }
                gameData.push(dataGame);
            }


            let viewFlag = true;
            let editFlag = true;
            let deleteFlag = true;
            let addFlag = true;
            let startFlag = true;
            let pauseFlag = true;

            console.log("stringReplace", req.session.details.isPermission);

            if (req.session.details.role == 'agent') {
                var stringReplace = req.session.details.isPermission['Games Management'];

                if (!stringReplace || stringReplace.indexOf("add") == -1) {
                    addFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("delete") == -1) {
                    deleteFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("start") == -1) {
                    startFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("pause") == -1) {
                    pauseFlag = false;
                }

            }


            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameManagement: 'active',
                DataOfGames: gameData,
                viewFlag: viewFlag,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                addFlag: addFlag,
                startFlag: startFlag,
                pauseFlag: pauseFlag

            };
            return res.render('GameManagement/game', data);


        } catch (error) {
            Sys.Log.error('Error in viweGameManagement: ', error);
            return new Error(error);
        }
    },


    viweGameManagementDetail: async function(req, res) {
        try {
            var gameType;
            //console.log("Req.params calling", req.params);

            if (req.params.id === null) {
                return res.send({ 'status': 'fail', message: 'Fail because option is not selected..' });
            } else {
                gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });
            }

            let Game;
            if (gameType.type == 'game_4') {
                Game = await Sys.App.Services.GameService.getSelectedGameCount({ gameType: 'game_4' });
            } else {
                Game = 0;
            }

            let addBtn = (Game >= 1) ? false : true;

            //console.log("gameType", gameType);
            var theadField;
            if (gameType.type == "game_1") {
                theadField = [
                    'Game Id',
                    'Game Type',
                    'Start Date and Time',
                    'Game Name',
                    'Ticket Color/Type',
                    //'Ticket price',
                    //'Total numbers of tickets sold',
                    //'Total Earned from tickets sold',
                    //'Total Winning in the game',
                    'Seconds',
                    'Action'
                ]
            } else if (gameType.type == "game_2") {
                theadField = [
                    'Game Id',
                    'Game Type',
                    'Start Date and Time',
                    'Ticket price',
                    'Jack pot number',
                    'Price in number',
                    'Total numbers of tickets sold',
                    'Total Earned from tickets sold',
                    'Total Winning in the game',
                    'Seconds',
                    'Action'
                ]

            } else if (gameType.type == "game_3") {
                theadField = [
                    'Game Id',
                    'Game Type',
                    'Start Date and Time',
                    'Ticket price',
                    'Total Number Of Tickets Sold',
                    'Total Earned From Tickets Sold',
                    'Total Winning In The Game',
                    'Seconds',
                    'Action'
                ]
            } else if (gameType.type == "game_4") {
                theadField = [
                    'Game Id',
                    'Pattern Name',
                    'Pattern Price',
                    'Action'
                ]
            } else {
                req.flash('error', 'Game Not Found');
                return res.redirect('/dashboard');
            }

            var data = {
                gameData: gameType,
                theadField: theadField,
                addBtn: addBtn,
                Game: Game
            };
            res.send(data);

        } catch (error) {
            Sys.Log.error('Error in viweGameManagementDetail: ', error);
            return new Error(error);
        }
    },

    getGameManagementDetailList: async function(req, res) {
        try {
            // console.log("getGameManagementDetailList calling", req.query.gameType);
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
            var gameName;
            let query = {}
            if (req.query.gameType == "game_1") {
                gameName = "Game1";
                query = { gameName: gameName, status: "active", isMasterGame: true };
            } else if (req.query.gameType == "game_2") {
                gameName = "Game2";
                query = { gameName: gameName, status: "active" };
            } else if (req.query.gameType == "game_3") {
                gameName = "Game3";
                query = { gameName: gameName, status: "active" };
            } else if (req.query.gameType == "game_4") {
                gameName = "Game4";
                query = { gameName: gameName, status: "active" };
            }

            if (search != '') {
                if (req.query.gameType == "game_1") {
                    query = { gameNumber: { $regex: '.*' + search + '.*' }, gameName: gameName, status: "active", isMasterGame: true };
                } else {
                    query = { gameNumber: { $regex: '.*' + search + '.*' }, gameName: gameName, status: "active" };
                }
            }

            // let startTo = new Date(req.query.start_date);
            // let endFrom = new Date(req.query.end_date);
            // endFrom.setHours(23, 59, 59);

            // if (req.query.is_date_search == "yes" && search == '') {
            //     query = { createdAt: { $gte: startTo, $lt: endFrom } };
            // }

            // if (req.query.is_date_search == "yes" && search != '') {
            //     query = { fullName: { $regex: '.*' + search + '.*' }, createdAt: { $gte: startTo, $lt: endFrom } };
            // }

            //console.log(query);
            let reqCount = await Sys.App.Services.GameService.getSelectedGameCount(query);

            let data = await Sys.App.Services.GameService.getGameDatatable(query, length, start);

            let gameData = [],
                patternName = [];
            if (req.query.gameType == "game_1") {

                for (let i = 0; i < data.length; i++) {

                    let dataGame = {}
                    let winnerAmount = 0;
                    if (data[i].purchasedTickets.length > 0) {

                        let GameAtm = await Sys.App.Services.GameService.getSingleGameData({ _id: data[i]._id });

                        for (let atm = 0; atm < GameAtm.purchasedTickets.length; atm++) {
                            winnerAmount += Number(GameAtm.purchasedTickets[atm].totalAmount)
                        }

                        dataGame = {
                            _id: data[i]._id,
                            gameNumber: data[i].gameNumber,
                            gameMode: data[i].gameMode,
                            startDate: data[i].startDate,
                            graceDate: data[i].graceDate,
                            gameName: data[i].subGames,
                            ticketColorType: data[i].subGames,
                            ticketPrice: data[i].ticketPrice,
                            totalNumberOfTicketsSold: Number(data[i].purchasedTickets.length),
                            totalEarnedFromTicketsSold: Number(winnerAmount),
                            totalWinningInTheGame: Number(data[i].winners.length),
                            seconds: Number(data[i].seconds / 1000),
                        }

                    } else {
                        dataGame = {
                            _id: data[i]._id,
                            gameNumber: data[i].gameNumber,
                            gameMode: data[i].gameMode,
                            startDate: data[i].startDate,
                            graceDate: data[i].graceDate,
                            gameName: data[i].subGames,
                            ticketColorType: data[i].subGames,
                            ticketPrice: data[i].ticketPrice,
                            totalNumberOfTicketsSold: Number(data[i].purchasedTickets.length),
                            totalEarnedFromTicketsSold: 0,
                            totalWinningInTheGame: Number(data[i].winners.length),
                            seconds: Number(data[i].seconds / 1000),
                        }
                    }


                    if (data[i].gameMode == 'auto' && data[i].graceDate == null) {
                        continue;
                    }
                    gameData.push(dataGame);
                }
            } else if (req.query.gameType == "game_2") {

                for (let i = 0; i < data.length; i++) {
                    let dataGame = {}
                    let winnerAmount = 0;
                    if (data[i].purchasedTickets.length > 0) {

                        let GameAtm = await Sys.App.Services.GameService.getSingleGameData({ _id: data[i]._id });

                        for (let atm = 0; atm < GameAtm.purchasedTickets.length; atm++) {
                            winnerAmount += Number(GameAtm.purchasedTickets[atm].totalAmount)
                        }

                        dataGame = {
                            _id: data[i]._id,
                            gameNumber: data[i].gameNumber,
                            gameMode: data[i].gameMode,
                            startDate: data[i].startDate,
                            graceDate: data[i].graceDate,
                            ticketPrice: data[i].ticketPrice,
                            jackPotNumber: data[i].jackPotNumber[0],
                            priceNumber: data[i].jackPotNumber[0],
                            totalNumberOfTicketsSold: Number(data[i].purchasedTickets.length),
                            totalEarnedFromTicketsSold: Number(winnerAmount),
                            totalWinningInTheGame: Number(data[i].winners.length),
                            seconds: Number(data[i].seconds / 1000),
                        }
                    } else {
                        dataGame = {
                            _id: data[i]._id,
                            gameNumber: data[i].gameNumber,
                            gameMode: data[i].gameMode,
                            startDate: data[i].startDate,
                            graceDate: data[i].graceDate,
                            ticketPrice: data[i].ticketPrice,
                            jackPotNumber: data[i].jackPotNumber[0],
                            priceNumber: data[i].jackPotNumber[0],
                            totalNumberOfTicketsSold: Number(data[i].purchasedTickets.length),
                            totalEarnedFromTicketsSold: Number(data[i].purchasedTickets.length * data[i].ticketPrice),
                            totalWinningInTheGame: Number(data[i].winners.length),
                            seconds: Number(data[i].seconds / 1000),
                        }
                    }

                    if (data[i].gameMode == 'auto' && data[i].graceDate == null) {
                        continue;
                    }
                    gameData.push(dataGame);
                }

            } else if (req.query.gameType == "game_3") {


                for (let i = 0; i < data.length; i++) {

                    let dataGame = {}
                    let winnerAmount = 0;
                    if (data[i].purchasedTickets.length > 0) {

                        let GameAtm = await Sys.App.Services.GameService.getSingleGameData({ _id: data[i]._id });

                        for (let atm = 0; atm < GameAtm.purchasedTickets.length; atm++) {
                            winnerAmount += Number(GameAtm.purchasedTickets[atm].totalAmount)
                        }

                        dataGame = {
                            _id: data[i]._id,
                            gameNumber: data[i].gameNumber,
                            gameMode: data[i].gameMode,
                            startDate: data[i].startDate,
                            graceDate: data[i].graceDate,
                            ticketPrice: data[i].ticketPrice,
                            totalNumberOfTicketsSold: Number(data[i].purchasedTickets.length),
                            totalEarnedFromTicketsSold: Number(winnerAmount),
                            totalWinningInTheGame: Number(data[i].winners.length),
                            seconds: Number(data[i].seconds / 1000),
                        }

                    } else {

                        dataGame = {
                            _id: data[i]._id,
                            gameNumber: data[i].gameNumber,
                            gameMode: data[i].gameMode,
                            startDate: data[i].startDate,
                            graceDate: data[i].graceDate,
                            ticketPrice: data[i].ticketPrice,
                            totalNumberOfTicketsSold: Number(data[i].purchasedTickets.length),
                            totalEarnedFromTicketsSold: Number(data[i].purchasedTickets.length * data[i].ticketPrice),
                            totalWinningInTheGame: Number(data[i].winners.length),
                            seconds: Number(data[i].seconds / 1000),
                        }

                    }

                    if (data[i].gameMode == 'auto' && data[i].graceDate == null) {
                        continue;
                    }
                    gameData.push(dataGame);
                }

            } else if (req.query.gameType == "game_4") {

                let ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_4" });

                if (data.length > 0) {

                    if (ptrn) {

                        for (let j = 0; j < ptrn.length; j++) {
                            let r = 1;
                            patternName.push({
                                patternName: ptrn[j].patternName,
                                patternPrice: data[0].patternNamePrice[0]['Pattern' + (j + r)],
                            });
                        }

                        for (let i = 0; i < data.length; i++) {
                            //console.log('data: ', data);
                            let dataGame = {
                                _id: data[i]._id,
                                gameNumber: data[i].gameNumber,
                                patternName: patternName,
                                patternPrice: patternName,
                            }
                            gameData.push(dataGame);
                        }

                    }

                }

            }



            function compareValues(key, order = 'asc') {
                return function innerSort(a, b) {
                    if (!a.hasOwnProperty(key) || !b.hasOwnProperty(key)) {
                        // property doesn't exist on either object
                        return 0;
                    }

                    const varA = (typeof a[key] === 'string') ?
                        a[key].toUpperCase() : a[key];
                    const varB = (typeof b[key] === 'string') ?
                        b[key].toUpperCase() : b[key];

                    let comparison = 0;
                    if (varA > varB) {
                        comparison = 1;
                    } else if (varA < varB) {
                        comparison = -1;
                    }
                    return (
                        (order === 'desc') ? (comparison * -1) : comparison
                    );
                };
            }

            let keyData = Object.keys(sort);
            let valueData = Object.values(sort);

            if (valueData[0] == 1) {
                gameData.sort(compareValues(keyData));
            } else if (valueData[0] == -1) {
                gameData.sort(compareValues(keyData, 'desc'));
            }

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': gameData,
            };

            //console.log("data:::::::::::::", gameData)

            res.send(obj);

        } catch (error) {
            Sys.Log.error('Error in getGameManagementDetailList: ', error);
            return new Error(error);
        }
    },

    addGameManagement: async function(req, res) {
        try {
            //console.log("addGame", req.params.id);
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });

            let ptrn;
            if (gameType.type == 'game_4') {
                ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_4" });
                let arr = ['priceOne', 'priceTwo', 'priceThree', 'priceFour', 'priceFive', 'priceSix', 'priceSeven', 'priceEight', 'priceNine', 'priceTen', 'priceEleven', 'priceTwelve', 'priceThirteen', 'priceFourteen', 'priceFifteen']

                for (let i = 0; i < ptrn.length; i++) {
                    ptrn[i].name = arr[i];
                }
            } else if (gameType.type == 'game_3') {
                ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_3" });
            }

            let hallArray;
            let agentHallArray;
            if (req.session.details.role == 'agent') {
                let agentId = await Sys.Helper.bingo.obId(req.session.details.id);
                agentHallArray = await Sys.App.Services.HallServices.getByData({ 'agents._id': agentId });
            } else {
                hallArray = await Sys.App.Services.HallServices.getByData();
            }

            let subGameList = await Sys.App.Services.subGame1Services.getAllDataSelect({ status: 'active' }, { ticketColor: 1, gameName: 1, subGameId: 1, gameType: 1, allPatternRowId: 1 });

            // [ Row and Color ]
            let subGameColorRow = {};
            let rows = [];
            for (let s = 0; s < subGameList.length; s++) {
                for (let r = 0; r < subGameList[s].allPatternRowId.length; r++) {
                    rows.push(subGameList[s].allPatternRowId[r])
                }
            }
            let patternListing = await Sys.App.Services.patternServices.getGamePatternData({ _id: { $in: rows } }, { isTchest: 1, isMys: 1, patternName: 1, patType: 1, isJackpot: 1, isGameTypeExtra: 1 });
            for (let s = 0; s < subGameList.length; s++) {
                let obj = {};
                obj.colors = subGameList[s].ticketColor;
                let rowsData = [];
                for (let r = 0; r < subGameList[s].allPatternRowId.length; r++) {
                    if (patternListing.length > 0) {
                        let index = patternListing.findIndex(e => e._id == subGameList[s].allPatternRowId[r].toString());
                        if (index !== -1) {
                            rowsData.push({ name: patternListing[index].patternName, type: patternListing[index].patType, isMys: patternListing[index].isMys, isTchest: patternListing[index].isTchest, isJackpot: patternListing[index].isJackpot , isGameTypeExtra :patternListing[index].isGameTypeExtra })
                        }
                    }
                }
                obj.rows = rowsData;
                obj.gameName = subGameList[s].gameName;
                obj.subGameId = subGameList[s].subGameId;
                obj.gameType = subGameList[s].gameType;
                subGameColorRow[subGameList[s].gameType] = obj;
            }


            //console.log("subGameColorRow", subGameColorRow)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameMenu: 'active',
                gameData: gameType,
                patternData: ptrn,
                pattern: ptrn,
                hallArray: hallArray,
                subGameList: subGameList,
                subGameColorRow: JSON.stringify(subGameColorRow),
                slug: 'Add',
                agentHallArray: agentHallArray
            };
            return res.render('GameManagement/gameAdd', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    addGameManagementPostData: async function(req, res) {
        try {
            //console.log("addGamePostData params", req.params.typeId, req.params.type);
            console.log("addGamePostData: ", req.body);
            //let randomNumber = Math.floor(100000 + Math.random() * 900000);

            var ID = Date.now()
            var createID = dateTimeFunction(ID);

            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                let seconds = dt.getSeconds();
                let miliSeconds = dt.getMilliseconds();
                let ampm = hours >= 12 ? 'pm' : 'am';
                hours = hours % 12;
                hours = hours ? hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                seconds = seconds < 10 ? '0' + seconds : seconds;
                let dateTime = year + '' + month + '' + date + '_' + hours + '' + minutes + seconds + miliSeconds;
                return dateTime; // Function returns the dateandtime
            }
            var game;

            if (req.params.type == "game_1") {
                let storeGamesData = [];
                let trafficLightOption = [];
                // For Single Game
                if (typeof(req.body.gameNameSelect) === 'string') {

                    // start 8 color of single inputs 
                    let optionSelect = req.body.gameNameSelect;
                    let fields = optionSelect.split('|');

                    let arrTicketColorType = [];
                    let arrSameColorType = [];
                    let subGameId = fields[0];
                    let subGameName = fields[1];
                    let subGameType = fields[2];

                    // console.log(" eightColorValues eightColorValues eightColorValues :",eightColorValues)

                    // console.log("eightColorInputRowsName eightColorInputRowsName aaaaaaaaaaaaaaa :",eightColorInputRowsName)
                    // console.log("eightColorInputValues eightColorInputValues bbbbbbbbbbbbbbb :",eightColorInputValues)

                    let smallWhiteColor = (Array.isArray(req.body[[subGameType] + '_smallWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallWhite'][0]) : 0;
                    let largeWhiteColor = (Array.isArray(req.body[[subGameType] + '_largeWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeWhite'][0]) : 0;
                    let smallYellowColor = (Array.isArray(req.body[[subGameType] + '_smallYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallYellow'][0]) : 0;
                    let largeYellowColor = (Array.isArray(req.body[[subGameType] + '_largeYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeYellow'][0]) : 0;
                    let smallPurpleColor = (Array.isArray(req.body[[subGameType] + '_smallPurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallPurple'][0]) : 0;
                    let largePurpleColor = (Array.isArray(req.body[[subGameType] + '_largePurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largePurple'][0]) : 0;
                    let smallBlueColor = (Array.isArray(req.body[[subGameType] + '_smallBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallBlue'][0]) : 0;
                    let largeBlueColor = (Array.isArray(req.body[[subGameType] + '_largeBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeBlue'][0]) : 0;
                    let elvis1 = (Array.isArray(req.body[[subGameType] + '_elvis1'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis1'][0]) : 0;
                    let elvis2 = (Array.isArray(req.body[[subGameType] + '_elvis2'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis2'][0]) : 0;
                    let elvis3 = (Array.isArray(req.body[[subGameType] + '_elvis3'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis3'][0]) : 0;
                    let elvis4 = (Array.isArray(req.body[[subGameType] + '_elvis4'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis4'][0]) : 0;
                    let elvis5 = (Array.isArray(req.body[[subGameType] + '_elvis5'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis5'][0]) : 0;
                    let red = (Array.isArray(req.body[[subGameType] + '_red'])) ? arrTicketColorType.push(req.body[[subGameType] + '_red'][0]) : 0;
                    let yellow = (Array.isArray(req.body[[subGameType] + '_yellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_yellow'][0]) : 0;
                    let green = (Array.isArray(req.body[[subGameType] + '_green'])) ? arrTicketColorType.push(req.body[[subGameType] + '_green'][0]) : 0;

                    let same2ColorRY = (req.body[[subGameType] + '_twoSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                    let same2ColorRG = (req.body[[subGameType] + '_twoSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;
                    let same2ColorYR = (req.body[[subGameType] + '_twoSameRow_Yellow_Red'] == 'true') ? arrSameColorType.push('Yellow_Red') : 0;
                    let same2ColorYG = (req.body[[subGameType] + '_twoSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                    let same2ColorGR = (req.body[[subGameType] + '_twoSameRow_Green_Red'] == 'true') ? arrSameColorType.push('Green_Red') : 0;
                    let same2ColorGY = (req.body[[subGameType] + '_twoSameRow_Green_Yellow'] == 'true') ? arrSameColorType.push('Green_Yellow') : 0;

                    let same3ColorRY = (req.body[[subGameType] + '_threeSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                    let same3ColorYG = (req.body[[subGameType] + '_threeSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                    let same3ColorRG = (req.body[[subGameType] + '_threeSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;


                    let optionCreate = [];
                    let ticketColorTypesNo = [];

                    for (let i = 0; i < arrTicketColorType.length; i++) {
                        console.log("arrTicketColorType[i]", arrTicketColorType[i]);



                        let ticketCount = 0;
                        let ticketPrice = 0;

                        if (arrTicketColorType[i] == "Small White") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallWhite'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallWhiteColor']);
                        } else if (arrTicketColorType[i] == "Large White") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeWhite'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeWhiteColor']);
                        } else if (arrTicketColorType[i] == "Small Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallYellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallYellowColor']);
                        } else if (arrTicketColorType[i] == "Large Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeYellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeYellowColor']);
                        } else if (arrTicketColorType[i] == "Small Purple") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallPurple'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallPurpleColor']);
                        } else if (arrTicketColorType[i] == "Large Purple") {
                            ticketPrice = Number(req.body[[subGameType] + '_largePurple'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largePurpleColor']);
                        } else if (arrTicketColorType[i] == "Small Blue") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallBlue'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallBlueColor']);
                        } else if (arrTicketColorType[i] == "Large Blue") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeBlue'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeBlueColor']);
                        } else if (arrTicketColorType[i] == "Elvis 1") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis1'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis1Color']);
                        } else if (arrTicketColorType[i] == "Elvis 2") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis2'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis2Color']);
                        } else if (arrTicketColorType[i] == "Elvis 3") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis3'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis3Color']);

                            //console.log("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa : ",req.body[[subGameType] + '__elvis3Color'])
                        } else if (arrTicketColorType[i] == "Elvis 4") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis4'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis4Color']);
                        } else if (arrTicketColorType[i] == "Elvis 5") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis5'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis5Color']);
                        } else if (arrTicketColorType[i] == "Red") {
                            ticketPrice = Number(req.body[[subGameType] + '_red'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_redColor']);
                        } else if (arrTicketColorType[i] == "Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_yellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_yellowColor']);
                        } else if (arrTicketColorType[i] == "Green") {
                            ticketPrice = Number(req.body[[subGameType] + '_green'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_greenColor']);
                        }


                        let eightColorFlg = false;
                        var indx = ETICKETCOLORS.findIndex(row => row == arrTicketColorType[i]);
                        if (indx >= 0) {
                            eightColorFlg = true;
                        }



                        let saveObj = {}

                        let ColorName = (arrTicketColorType[i] == "Small White") ? "smallWhite" : (arrTicketColorType[i] == "Large White") ? "largeWhite" : (arrTicketColorType[i] == "Small Yellow") ? "smallYellow" : (arrTicketColorType[i] == "Large Yellow") ? "largeYellow" : (arrTicketColorType[i] == "Small Purple") ? "smallPurple" : (arrTicketColorType[i] == "Large Purple") ? "largePurple" : (arrTicketColorType[i] == "Small Blue") ? "smallBlue" : (arrTicketColorType[i] == "Large Blue") ? "largeBlue" : (arrTicketColorType[i] == "Elvis 1") ? "elvis1" : (arrTicketColorType[i] == "Elvis 2") ? "elvis2" : (arrTicketColorType[i] == "Elvis 3") ? "elvis3" : (arrTicketColorType[i] == "Elvis 4") ? "elvis4" : (arrTicketColorType[i] == "Elvis 5") ? "elvis5" : (arrTicketColorType[i] == "Red") ? "red" : (arrTicketColorType[i] == "Yellow") ? "yellow" : (arrTicketColorType[i] == "Green") ? "green" : "";

                        ticketColorTypesNo.push({
                            ticketName: arrTicketColorType[i],
                            ticketType: ColorName,
                            ticketPrice: ticketPrice,
                            ticketCount: ticketCount
                        });


                        //saveObj[ColorName] 
                        saveObj = {
                            ticketName: arrTicketColorType[i],
                            ticketType: ColorName,
                            ticketPrice: ticketPrice,
                            ticketCount: ticketCount,
                            totalPurchasedTickets: 0,
                            isEightColors: eightColorFlg,
                            jackpot: {
                                price: Number(req.body['jackpotPrice' + [subGameType]]),
                                draw: Number(req.body['jackpotDraws' + [subGameType]])
                            },
                        }

                        let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                        //let winning = {};
                        let winning = [];
                        let tmpBody = req.body;
                        let rowPattern = subGameRowData.patternRow;

                        console.log(" subGameRowData subGameRowData :", subGameRowData)
                        console.log("  subGameId subGameId :" + subGameId)

                        for (let j = 0; j < rowPattern.length; j++) {

                            let tmpObj = {
                                winningPatternName: rowPattern[j].name,
                                winningPatternType: rowPattern[j].patType,
                                pattern: rowPattern[j].patternType,
                                isWoF: rowPattern[j].isWoF,
                                isTchest: rowPattern[j].isTchest,
                                isMys: rowPattern[j].isMys,
                                extraPercent: rowPattern[j].rowPercentage,
                                status: rowPattern[j].status,
                                isJackpot: rowPattern[j].isJackpot,
                                isGameTypeExtra: rowPattern[j].isGameTypeExtra
                            }

                            console.log(" ([subGameType] + [rowPattern[j].patType] in req.body) :", req.body[[subGameType] + [rowPattern[j].patType]], " arrTicketColorType[i] arrTicketColorType[i] : ", arrTicketColorType[i])

                            console.log(" [subGameType] : ", [subGameType], " [rowPattern[j].patType] : ", [rowPattern[j].patType])

                            if (arrTicketColorType[i] == "Small White" || arrTicketColorType[i] == "Large White" || arrTicketColorType[i] == "Small Yellow" || arrTicketColorType[i] == "Large Yellow" || arrTicketColorType[i] == "Small Purple" || arrTicketColorType[i] == "Large Purple" || arrTicketColorType[i] == "Small Blue" || arrTicketColorType[i] == "Large Blue") {
                                if (([subGameType] + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + [rowPattern[j].patType]] != '') { // This check this key in req.body if yes process other wise skip

                                    let extraWinnings = {}
                                    if (tmpObj.isMys == true) {
                                        extraWinnings = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                        }
                                    }
                                    let tChest = {};
                                    if (tmpObj.isTchest == true) {
                                        tChest = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                            prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                            prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                            prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                            prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                            prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                            prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                            prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                        }
                                    }

                                    tmpObj.extraWinningsTchest = tChest;
                                    //tmpObj[rowPattern[j].patType] = Number(tmpBody[[subGameType] + [rowPattern[j].patType]])
                                    if(tmpObj.isGameTypeExtra==true){
                                        tmpObj.winningValue=Number(0); 
                                    }else{
                                        tmpObj.winningValue = Number(tmpBody[[subGameType] + [rowPattern[j].patType]]);
                                    }
                                    
                                    tmpObj.extraWinnings = extraWinnings;
                                    //winning[rowPattern[j].patType] = tmpObj;
                                    winning.push(tmpObj);

                                }

                            } else if (arrTicketColorType[i] == "Elvis 1" || arrTicketColorType[i] == "Elvis 2" || arrTicketColorType[i] == "Elvis 3" || arrTicketColorType[i] == "Elvis 4" || arrTicketColorType[i] == "Elvis 5" || arrTicketColorType[i] == "Red" || arrTicketColorType[i] == "Yellow" || arrTicketColorType[i] == "Green") {
                                if (([subGameType] + '_' + ColorName + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + '_' + ColorName + [rowPattern[j].patType]] != '') {

                                    let extraWinnings = {};
                                    if (tmpObj.isMys == true) {
                                        extraWinnings = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                        }
                                    }
                                    let tChest = {};
                                    if (tmpObj.isTchest == true) {
                                        tChest = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                            prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                            prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                            prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                            prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                            prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                            prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                            prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                        }
                                    }

                                    tmpObj.extraWinningsTchest = tChest;
                                    //tmpObj[rowPattern[j].patType] = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]])
                                    tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);
                                    
                                    if(tmpObj.isGameTypeExtra==true){
                                        tmpObj.winningValue=Number(0); 
                                    }else{
                                        tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);
                                    }
                                   
                                    tmpObj.extraWinnings = extraWinnings;
                                    //winning[rowPattern[j].patType] = tmpObj;
                                    winning.push(tmpObj);
                                }
                            }
                        }

                        //saveObj[ColorName].winning = winning;
                        saveObj.winning = winning;
                        optionCreate.push(saveObj);

                    }

                    let obj = {
                        //[subGameType]: {
                        subGameId: subGameId,
                        gameName: subGameName,
                        gameType: subGameType,
                        ticketColorTypes: arrTicketColorType,
                        ticketColorTypesNo: ticketColorTypesNo,
                        jackpotValues: {
                            price: Number(req.body['jackpotPrice' + [subGameType]]),
                            draw: Number(req.body['jackpotDraws' + [subGameType]])
                        },
                        options: optionCreate,

                        //}
                    }
                    storeGamesData.push(obj);

                    // Same Color save
                    let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });

                    for (let k = 0; k < arrSameColorType.length; k++) {
                        console.log(" arrSameColorType arrSameColorType : : :")
                        let saveObj = {};
                        // let winning = {};
                        let winning = [];
                        let tmpBody = req.body;
                        let rowPattern = subGameRowData.patternRow;

                        let strLtd = arrSameColorType[k];
                        let splitColor = strLtd.split('_');
                        let nameColor1 = splitColor[0];
                        let nameColor2 = splitColor[1];

                        console.log(" rowPattern rowPattern rowPattern if : ",rowPattern)


                        for (let j = 0; j < rowPattern.length; j++) {

                            let tmpObj = {
                                pattern: rowPattern[j].patternType,
                                isWoF: rowPattern[j].isWoF,
                                isTchest: rowPattern[j].isTchest,
                                isMys: rowPattern[j].isMys,
                                extraPercent: rowPattern[j].rowPercentage,
                                status: rowPattern[j].status,
                                isJackpot: rowPattern[j].isJackpot,
                                
                            }

                            let extraWinnings = {};
                            if (tmpObj.isMys == true) {
                                extraWinnings = {
                                    prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                    prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                    prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                    prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                    prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                }
                            }

                            tmpObj[rowPattern[j].patType] = {
                                [nameColor1.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor1 + '_' + [rowPattern[j].patType]]),
                                [nameColor2.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor2 + '_' + [rowPattern[j].patType]]),
                            }

                            tmpObj.rowKey = rowPattern[j].patType;
                            tmpObj.rowName = rowPattern[j].name;

                            let tChest = {};
                            if (tmpObj.isTchest == true) {
                                tChest = {
                                    prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                    prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                    prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                    prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                    prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                    prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                    prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                    prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                    prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                    prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                    prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                    prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                }
                            }

                            tmpObj.extraWinningsTchest = tChest;
                            tmpObj.extraWinnings = extraWinnings;
                            //winning[rowPattern[j].patType] = tmpObj;

                            winning.push(tmpObj);

                        }

                        saveObj = {
                            subGameId: subGameId,
                            gameName: subGameName,
                            gameType: subGameType,
                            type: subGameType + "_" + arrSameColorType[k],
                            gameColorsCmbName: subGameType+" "+nameColor1+" & "+nameColor2, 
                            winning: winning
                        }

                        trafficLightOption.push(saveObj);
                    }

                } else { // For Multiple Game
                    for (let r = 0; r < req.body.gameNameSelect.length; r++) {

                        let optionSelect = req.body.gameNameSelect[r];
                        let fields = optionSelect.split('|');
                        let arrSameColorType = [];
                        let arrTicketColorType = [];
                        let subGameId = fields[0];
                        let subGameName = fields[1];
                        let subGameType = fields[2];


                        let smallWhiteColor = (Array.isArray(req.body[[subGameType] + '_smallWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallWhite'][0]) : 0;
                        let largeWhiteColor = (Array.isArray(req.body[[subGameType] + '_largeWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeWhite'][0]) : 0;
                        let smallYellowColor = (Array.isArray(req.body[[subGameType] + '_smallYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallYellow'][0]) : 0;
                        let largeYellowColor = (Array.isArray(req.body[[subGameType] + '_largeYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeYellow'][0]) : 0;
                        let smallPurpleColor = (Array.isArray(req.body[[subGameType] + '_smallPurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallPurple'][0]) : 0;
                        let largePurpleColor = (Array.isArray(req.body[[subGameType] + '_largePurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largePurple'][0]) : 0;
                        let smallBlueColor = (Array.isArray(req.body[[subGameType] + '_smallBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallBlue'][0]) : 0;
                        let largeBlueColor = (Array.isArray(req.body[[subGameType] + '_largeBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeBlue'][0]) : 0;
                        let elvis1 = (Array.isArray(req.body[[subGameType] + '_elvis1'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis1'][0]) : 0;
                        let elvis2 = (Array.isArray(req.body[[subGameType] + '_elvis2'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis2'][0]) : 0;
                        let elvis3 = (Array.isArray(req.body[[subGameType] + '_elvis3'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis3'][0]) : 0;
                        let elvis4 = (Array.isArray(req.body[[subGameType] + '_elvis4'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis4'][0]) : 0;
                        let elvis5 = (Array.isArray(req.body[[subGameType] + '_elvis5'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis5'][0]) : 0;
                        let red = (Array.isArray(req.body[[subGameType] + '_red'])) ? arrTicketColorType.push(req.body[[subGameType] + '_red'][0]) : 0;
                        let yellow = (Array.isArray(req.body[[subGameType] + '_yellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_yellow'][0]) : 0;
                        let green = (Array.isArray(req.body[[subGameType] + '_green'])) ? arrTicketColorType.push(req.body[[subGameType] + '_green'][0]) : 0;


                        let same2ColorRY = (req.body[[subGameType] + '_twoSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                        let same2ColorRG = (req.body[[subGameType] + '_twoSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;
                        let same2ColorYR = (req.body[[subGameType] + '_twoSameRow_Yellow_Red'] == 'true') ? arrSameColorType.push('Yellow_Red') : 0;
                        let same2ColorYG = (req.body[[subGameType] + '_twoSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                        let same2ColorGR = (req.body[[subGameType] + '_twoSameRow_Green_Red'] == 'true') ? arrSameColorType.push('Green_Red') : 0;
                        let same2ColorGY = (req.body[[subGameType] + '_twoSameRow_Green_Yellow'] == 'true') ? arrSameColorType.push('Green_Yellow') : 0;

                        let same3ColorRY = (req.body[[subGameType] + '_threeSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                        let same3ColorYG = (req.body[[subGameType] + '_threeSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                        let same3ColorRG = (req.body[[subGameType] + '_threeSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;

                        let optionCreate = [];

                        let ticketColorTypesNo = [];

                        for (let i = 0; i < arrTicketColorType.length; i++) {

                            let ticketCount = 0;
                            let ticketPrice = 0;

                            if (arrTicketColorType[i] == "Small White") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallWhite'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallWhiteColor']);
                            } else if (arrTicketColorType[i] == "Large White") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeWhite'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeWhiteColor']);
                            } else if (arrTicketColorType[i] == "Small Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallYellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallYellowColor']);
                            } else if (arrTicketColorType[i] == "Large Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeYellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeYellowColor']);
                            } else if (arrTicketColorType[i] == "Small Purple") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallPurple'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallPurpleColor']);
                            } else if (arrTicketColorType[i] == "Large Purple") {
                                ticketPrice = Number(req.body[[subGameType] + '_largePurple'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largePurpleColor']);
                            } else if (arrTicketColorType[i] == "Small Blue") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallBlue'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallBlueColor']);
                            } else if (arrTicketColorType[i] == "Large Blue") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeBlue'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeBlueColor']);
                            } else if (arrTicketColorType[i] == "Elvis 1") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis1'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis1Color']);
                            } else if (arrTicketColorType[i] == "Elvis 2") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis2'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis2Color']);
                            } else if (arrTicketColorType[i] == "Elvis 3") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis3'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis3Color']);
                            } else if (arrTicketColorType[i] == "Elvis 4") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis4'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis4Color']);
                            } else if (arrTicketColorType[i] == "Elvis 5") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis5'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis5Color']);
                            } else if (arrTicketColorType[i] == "Red") {
                                ticketPrice = Number(req.body[[subGameType] + '_red'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_redColor']);
                            } else if (arrTicketColorType[i] == "Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_yellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_yellowColor']);
                            } else if (arrTicketColorType[i] == "Green") {
                                ticketPrice = Number(req.body[[subGameType] + '_green'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_greenColor']);
                            }


                            let eightColorFlg = false;
                            var indx = ETICKETCOLORS.findIndex(row => row == arrTicketColorType[i]);
                            if (indx >= 0) {
                                eightColorFlg = true;
                            }


                            let saveObj = {}

                            let ColorName = (arrTicketColorType[i] == "Small White") ? "smallWhite" : (arrTicketColorType[i] == "Large White") ? "largeWhite" : (arrTicketColorType[i] == "Small Yellow") ? "smallYellow" : (arrTicketColorType[i] == "Large Yellow") ? "largeYellow" : (arrTicketColorType[i] == "Small Purple") ? "smallPurple" : (arrTicketColorType[i] == "Large Purple") ? "largePurple" : (arrTicketColorType[i] == "Small Blue") ? "smallBlue" : (arrTicketColorType[i] == "Large Blue") ? "largeBlue" : (arrTicketColorType[i] == "Elvis 1") ? "elvis1" : (arrTicketColorType[i] == "Elvis 2") ? "elvis2" : (arrTicketColorType[i] == "Elvis 3") ? "elvis3" : (arrTicketColorType[i] == "Elvis 4") ? "elvis4" : (arrTicketColorType[i] == "Elvis 5") ? "elvis5" : (arrTicketColorType[i] == "Red") ? "red" : (arrTicketColorType[i] == "Yellow") ? "yellow" : (arrTicketColorType[i] == "Green") ? "green" : "";

                            ticketColorTypesNo.push({
                                ticketName: arrTicketColorType[i],
                                ticketType: ColorName,
                                ticketPrice: ticketPrice,
                                ticketCount: ticketCount
                            });



                            //saveObj[ColorName] 
                            saveObj = {
                                ticketName: arrTicketColorType[i],
                                ticketType: ColorName,
                                ticketPrice: ticketPrice,
                                ticketCount: ticketCount,
                                totalPurchasedTickets: 0,
                                isEightColors: eightColorFlg,
                                jackpot: {
                                    price: Number(req.body['jackpotPrice' + [subGameType]]),
                                    draw: Number(req.body['jackpotDraws' + [subGameType]])
                                },
                            }

                            let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                            //let winning = {};
                            let winning = [];
                            let tmpBody = req.body;
                            let rowPattern = subGameRowData.patternRow;
                            console.log(" rowPattern rowPattern rowPattern else : ",rowPattern)
                            for (let j = 0; j < rowPattern.length; j++) {

                                let tmpObj = {
                                    winningPatternName: rowPattern[j].name,
                                    winningPatternType: rowPattern[j].patType,
                                    pattern: rowPattern[j].patternType,
                                    isWoF: rowPattern[j].isWoF,
                                    isTchest: rowPattern[j].isTchest,
                                    isMys: rowPattern[j].isMys,
                                    extraPercent: rowPattern[j].rowPercentage,
                                    status: rowPattern[j].status,
                                    isJackpot: rowPattern[j].isJackpot,
                                    isGameTypeExtra: rowPattern[j].isGameTypeExtra,
                                    
                                }

                                if (arrTicketColorType[i] == "Small White" || arrTicketColorType[i] == "Large White" || arrTicketColorType[i] == "Small Yellow" || arrTicketColorType[i] == "Large Yellow" || arrTicketColorType[i] == "Small Purple" || arrTicketColorType[i] == "Large Purple" || arrTicketColorType[i] == "Small Blue" || arrTicketColorType[i] == "Large Blue") {
                                    if (([subGameType] + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + [rowPattern[j].patType]] != '') { // This check this key in req.body if yes process other wise skip

                                        let extraWinnings = {}
                                        let tChest = {}

                                        if (tmpObj.isMys == true) {
                                            extraWinnings = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                            }
                                        }

                                        if (tmpObj.isTchest == true) {
                                            tChest = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                                prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                                prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                                prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                                prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                                prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                                prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                                prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                            }
                                        }

                                        tmpObj.extraWinningsTchest = tChest;
                                        //tmpObj[rowPattern[j].patType] = Number(tmpBody[[subGameType] + [rowPattern[j].patType]])

                                        if(tmpObj.isGameTypeExtra==true){
                                            tmpObj.winningValue=Number(0); 
                                        }else{
                                            tmpObj.winningValue = Number(tmpBody[[subGameType] + [rowPattern[j].patType]]);
                                        }
                                        tmpObj.extraWinnings = extraWinnings;
                                        //winning[rowPattern[j].patType] = tmpObj;
                                        winning.push(tmpObj);

                                    }

                                } else if (arrTicketColorType[i] == "Elvis 1" || arrTicketColorType[i] == "Elvis 2" || arrTicketColorType[i] == "Elvis 3" || arrTicketColorType[i] == "Elvis 4" || arrTicketColorType[i] == "Elvis 5" || arrTicketColorType[i] == "Red" || arrTicketColorType[i] == "Yellow" || arrTicketColorType[i] == "Green") {
                                    if (([subGameType] + '_' + ColorName + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + '_' + ColorName + [rowPattern[j].patType]] != '') {
                                        let tChest = {}
                                        let extraWinnings = {};

                                        if (tmpObj.isMys == true) {
                                            extraWinnings = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                            }
                                        }

                                        if (tmpObj.isTchest == true) {
                                            tChest = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                                prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                                prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                                prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                                prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                                prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                                prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                                prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                            }
                                        }

                                        tmpObj.extraWinningsTchest = tChest;
                                        //tmpObj[rowPattern[j].patType] = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]])
                                        
                                        if(tmpObj.isGameTypeExtra==true){
                                            tmpObj.winningValue=Number(0); 
                                        }else{
                                            tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);
                                        }

                                        tmpObj.extraWinnings = extraWinnings;
                                        //winning[rowPattern[j].patType] = tmpObj;
                                        winning.push(tmpObj);

                                    }
                                }
                            }
                            //saveObj[ColorName].winning = winning;
                            saveObj.winning = winning;
                            optionCreate.push(saveObj);

                        }

                        let obj = {
                            //[subGameType]: {
                            subGameId: subGameId,
                            gameName: subGameName,
                            gameType: subGameType,
                            ticketColorTypes: arrTicketColorType,
                            ticketColorTypesNo: ticketColorTypesNo,
                            jackpotValues: {
                                price: Number(req.body['jackpotPrice' + [subGameType]]),
                                draw: Number(req.body['jackpotDraws' + [subGameType]])
                            },
                            options: optionCreate
                                //}
                        }
                        storeGamesData.push(obj);


                        // Same Color save
                        let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                        for (let k = 0; k < arrSameColorType.length; k++) {
                            let saveObj = {};
                            //let winning = {};
                            let winning = [];
                            let tmpBody = req.body;
                            let rowPattern = subGameRowData.patternRow;

                            let strLtd = arrSameColorType[k];
                            let splitColor = strLtd.split('_');
                            let nameColor1 = splitColor[0];
                            let nameColor2 = splitColor[1];

                            for (let j = 0; j < rowPattern.length; j++) {

                                let tmpObj = {
                                    pattern: rowPattern[j].patternType,
                                    isWoF: rowPattern[j].isWoF,
                                    isTchest: rowPattern[j].isTchest,
                                    isMys: rowPattern[j].isMys,
                                    extraPercent: rowPattern[j].rowPercentage,
                                    status: rowPattern[j].status,
                                    isJackpot: rowPattern[j].isJackpot
                                }

                                let extraWinnings = {};
                                if (tmpObj.isMys == true) {
                                    extraWinnings = {
                                        prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                        prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                        prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                        prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                        prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                    }
                                }

                                tmpObj[rowPattern[j].patType] = {
                                    [nameColor1.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor1 + '_' + [rowPattern[j].patType]]),
                                    [nameColor2.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor2 + '_' + [rowPattern[j].patType]]),
                                }

                                tmpObj.rowKey = rowPattern[j].patType;
                                tmpObj.rowName = rowPattern[j].name;

                                let tChest = {};
                                if (tmpObj.isTchest == true) {
                                    tChest = {
                                        prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                        prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                        prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                        prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                        prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                        prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                        prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                        prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                        prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                        prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                        prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                        prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                    }
                                }

                                tmpObj.extraWinningsTchest = tChest;
                                tmpObj.extraWinnings = extraWinnings;
                                // winning[rowPattern[j].patType] = tmpObj;
                                winning.push(tmpObj);
                            }

                            saveObj = {
                                subGameId: subGameId,
                                gameName: subGameName,
                                gameType: subGameType,
                                type: subGameType + "_" + arrSameColorType[k],
                                gameColorsCmbName: subGameType+" "+nameColor1+" & "+nameColor2, 
                                winning: winning
                            }

                            trafficLightOption.push(saveObj);
                        }

                    }
                }


                let hallArray = [];
                let hall = req.body.hallSelecteds;
                let hallData, hallObj = {};
                let allHallTabaleId = [];

                if (typeof(hall) === 'string') {
                    console.log("hall", hall);
                    let hallId = await Sys.Helper.bingo.obId(hall);
                    hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                    if (!hallData) {
                        req.flash('error', 'Hall Not Found');
                        return res.redirect('/agent');
                    } else {
                        hallObj = {
                            _id: hallData._id,
                            name: hallData.name,
                            hallId: hallData.hallId,
                            status: hallData.status
                        }
                        hallArray.push(hallObj);
                        allHallTabaleId.push(hallData._id);
                    }
                } else {
                    for (let i = 0; i < hall.length; i++) {
                        let hallId = await Sys.Helper.bingo.obId(hall[i]);
                        hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                        if (!hallData) {
                            req.flash('error', 'Hall Not Found');
                            return res.redirect('/agent');
                        } else {
                            hallObj = {
                                _id: hallData._id,
                                name: hallData.name,
                                hallId: hallData.hallId,
                                status: hallData.status
                            }
                            hallArray.push(hallObj);
                            allHallTabaleId.push(hallData._id);
                        }
                    }
                }

                let masterObj = {};
                if (typeof(req.body.masterHallSelected) === 'string') {
                    let hallId = await Sys.Helper.bingo.obId(req.body.masterHallSelected);
                    hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                    if (!hallData) {
                        req.flash('error', 'Hall Not Found');
                        return res.redirect('/gameManagement');
                    } else {
                        masterObj = {
                            _id: hallData._id,
                            name: hallData.name,
                            hallId: hallData.hallId,
                            status: hallData.status
                        }
                    }
                }

                game = await Sys.App.Services.GameService.insertGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game1',
                    gameNumber: createID + '_G1',
                    gameType: req.params.type,
                    status: "active",
                    day: req.body.day,
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    startDate: req.body.start_date,
                    graceDate: req.body.grace_time,
                    minTicketCount: req.body.minTicketCount,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    seconds: req.body.seconds * 1000,
                    trafficLightExtraOptions: trafficLightOption,
                    subGames: storeGamesData,
                    halls: hallArray,
                    allHallsId: allHallTabaleId,
                    masterHall: masterObj,
                    isMasterGame: true,
                    isSubGame: false
                });

                for (let o = 0; o < storeGamesData.length; o++) {
                    let subID = Date.now()
                    let subCreateID = dateTimeFunction(subID);
                    let SubGameAdd = await Sys.App.Services.GameService.insertGameData({
                        gameMode: req.body.gameMode,
                        gameName: 'Game1',
                        gameNumber: subCreateID + '_G1',
                        gameType: req.params.type,
                        status: "active",
                        day: req.body.day,
                        gameTypeId: req.params.typeId,
                        createrId: req.session.details.id,
                        startDate: req.body.start_date,
                        graceDate: req.body.grace_time,
                        minTicketCount: req.body.minTicketCount,
                        notificationStartTime: req.body.notificationStartTime,
                        luckyNumberPrize: req.body.luckyNumberPrize,
                        seconds: req.body.seconds * 1000,
                        trafficLightExtraOptions: trafficLightOption,
                        subGames: storeGamesData[o],
                        halls: hallArray,
                        allHallsId: allHallTabaleId,
                        masterHall: masterObj,
                        isMasterGame: false,
                        parentGameId: game._id,
                        isSubGame: true
                    });

                }


            } else if (req.params.type == "game_2") {

                let query = { _id: req.params.typeId };
                let gameType = await Sys.App.Services.GameService.getGameTypeById(query);
                //console.log("gameType", gameType);


                game = await Sys.App.Services.GameService.insertGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game2',
                    gameNumber: createID + '_G2',
                    gameType: req.params.type,
                    status: "active",
                    day: req.body.day,
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    startDate: req.body.start_date,
                    graceDate: req.body.grace_time,
                    minTicketCount: req.body.minTicketCount,
                    totalNoTickets: req.body.totalNoTickets,
                    totalNoPurchasedTickets: req.body.totalNoTickets,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    ticketPrice: req.body.ticketPrice,
                    seconds: req.body.seconds * 1000,
                    jackPotNumber: {
                        9: req.body.priceNine,
                        10: req.body.priceTen,
                        11: req.body.priceEleven,
                        12: req.body.priceTwelve,
                        13: req.body.priceThirteen,
                        1421: req.body.priceFourteenToTwentyone,
                    }
                });

                var sendData = {
                    columns: gameType.columns,
                    slug: gameType.type,
                    ticketSize: game.totalNoTickets,
                    gameId: game._id
                }

                console.log("sendData: ", sendData);

                var ticketBook = await Sys.Helper.bingo.ticketBook(sendData);


                // let game2Redis = await redisClient.set('game2', game);
                // console.log("game2Redis", game2Redis);
            } else if (req.params.type == "game_3") {
                var patternGroupNumberPrize = [];

                let gameType = await Sys.App.Services.GameService.getGameTypeById({ type: 'game_3' });

                game = await Sys.App.Services.GameService.insertGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game3',
                    gameNumber: createID + '_G3',
                    gameType: req.params.type,
                    status: "active",
                    day: req.body.day,
                    columns: gameType.columns,
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    startDate: req.body.start_date,
                    graceDate: req.body.grace_time,
                    minTicketCount: req.body.minTicketCount,
                    totalNoTickets: req.body.totalNoTickets,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    ticketPrice: req.body.ticketPrice,
                    patternGroupNumberPrize: patternGroupNumberPrize,
                    seconds: req.body.seconds * 1000,
                });

            } else if (req.params.type == "game_4") {

                // [ String To Number ]
                var newArrayBetAmount = req.body.betAmount.map(function(x) {
                    return parseInt(x, 10);
                });

                let n = 3; // [ Array Rows ]

                let arr1 = [];
                let arr2 = [];
                let arr3 = [];
                let arr4 = [];

                let cntt = 0;
                for (let i = 0; i < newArrayBetAmount.length; i++) {
                    let index = newArrayBetAmount.indexOf(newArrayBetAmount[i]);

                    if (cntt == n) {
                        arr1.push(newArrayBetAmount[i]);
                        cntt = 0;
                    } else if (cntt == (n - 1)) {
                        arr2.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    } else if (cntt == (n - 2)) {
                        arr3.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    } else {
                        arr4.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    }
                }

                let result = [
                    [...arr4],
                    [...arr3],
                    [...arr2],
                    [...arr1]
                ];

                let json = {};
                for (let i = 0; i < 4; i++) {
                    json['ticket' + (i + 1) + 'Multiplier'] = result[i];
                }

                game = await Sys.App.Services.GameService.insertGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game4',
                    gameNumber: createID + '_G4',
                    gameType: req.params.type,
                    status: "active",
                    day: req.body.day,
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    totalNoTickets: 4,
                    betAmount: req.body.betAmount,
                    ticketPrice: 1, //req.body.ticketPrice,
                    betMultiplier: req.body.betMultiplier,
                    betData: json,
                    seconds2: req.body.seconds2 * 1000,
                    seconds: req.body.seconds * 1000,
                    patternNamePrice: {
                        'Pattern1': req.body.priceOne,
                        'Pattern2': req.body.priceTwo,
                        'Pattern3': req.body.priceThree,
                        'Pattern4': req.body.priceFour,
                        'Pattern5': req.body.priceFive,
                        'Pattern6': req.body.priceSix,
                        'Pattern7': req.body.priceSeven,
                        'Pattern8': req.body.priceEight,
                        'Pattern9': req.body.priceNine,
                        'Pattern10': req.body.priceTen,
                        'Pattern11': req.body.priceEleven,
                        'Pattern12': req.body.priceTwelve,
                        'Pattern13': req.body.priceThirteen,
                        'Pattern14': req.body.priceFourteen,
                        'Pattern15': req.body.priceFifteen
                    }
                });

            }

            if (!game) {
                req.flash('error', 'Game was not created');
                return res.redirect('/gameManagement');
            } else {
                req.flash('success', 'Game was create successfully');
                return res.redirect('/gameManagement');
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    patternGame: async function(req, res) {
        try {

            console.log('req.body: ', req.body);

            var game;
            var ID = Date.now();

            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                let seconds = dt.getSeconds();
                let miliSeconds = dt.getMilliseconds();
                let ampm = hours >= 12 ? 'pm' : 'am';
                hours = hours % 12;
                hours = hours ? hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                seconds = seconds < 10 ? '0' + seconds : seconds;
                let dateTime = year + '' + month + '' + date + '_' + hours + '' + minutes + seconds + miliSeconds;
                return dateTime; // Function returns the dateandtime
            }
            var createID = dateTimeFunction(ID);

            let tmpp = await Sys.App.Services.GameService.getGameTypeByData({ type: req.body.gameType });

            var prtnAr = req.body.prtnAr;
            let shivshakti = [].concat.apply([], req.body.allPatternArray);

            game = await Sys.App.Services.GameService.insertGameData({
                gameMode: req.body.gameMode,
                gameName: 'Game3',
                gameNumber: createID + '_G3',
                status: "active",
                gameType: req.body.gameType,
                gameTypeId: tmpp._id,
                day: req.body.day,
                createrId: req.session.details.id,
                startDate: req.body.start_date,
                graceDate: req.body.grace_time,
                minTicketCount: req.body.minTicketCount,
                totalNoTickets: req.body.totalNoTickets,
                totalNoPurchasedTickets: req.body.totalNoTickets,
                notificationStartTime: req.body.notificationStartTime,
                luckyNumberPrize: req.body.luckyNumberPrize,
                ticketPrice: req.body.ticketPrice,
                patternGroupNumberPrize: prtnAr,
                allPatternArray: shivshakti,
                seconds: req.body.seconds * 1000
            });
            game = JSON.stringify(game);
            // let shakti = await redisClient.set('game3' + game._id, game);

            if (req.body.isSavedGame == 'true') {
                let data = {
                    startDate: req.body.start_date,
                    graceDate: req.body.grace_time,
                    day: req.body.day,
                    minTicketCount: req.body.minTicketCount,
                    totalNoTickets: req.body.totalNoTickets,
                    totalNoPurchasedTickets: req.body.totalNoTickets,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    ticketPrice: req.body.ticketPrice,
                    patternGroupNumberPrize: prtnAr,
                    allPatternArray: shivshakti,
                    seconds: req.body.seconds * 1000
                }
                await Sys.App.Services.GameService.updateSaveGameData({ _id: req.body.gameId }, data)
            }

            if (!game) {
                return res.send("error");
            } else {
                return res.send("success");
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    editGameManagement: async function(req, res) {
        try {
            //console.log("editGame", req.params);

            let Game = await Sys.App.Services.GameService.getById({ _id: req.params.id });
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });

            var startDateAt = dateTimeFunction(Game.startDate);
            var graceDateAt = dateTimeFunction(Game.graceDate);

            // let ptrn = await Sys.App.Services.patternServices.patternFindAll({ "gameType": "game_4" });

            function dateTimeFunction(dateData) {
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
                let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes + ' ' + ampm;
                return dateTime; // Function returns the dateandtime
            }
            //console.log("Game: ", Game);
            // console.log("ptrn: ", ptrn);

            let ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_4" });

            let arr = ['Pattern1', 'Pattern2', 'Pattern3', 'Pattern4', 'Pattern5', 'Pattern6', 'Pattern7', 'Pattern8', 'Pattern9', 'Pattern10', 'Pattern11', 'Pattern12', 'Pattern13', 'Pattern14', 'Pattern15']

            let printDataPattern = Game.patternNamePrice[0];
            for (let i = 0; i < ptrn.length; i++) {
                ptrn[i].name = arr[i];
                ptrn[i].price = printDataPattern['Pattern' + (i + 1)];
            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameMenu: 'active',
                Game: Game,
                pattern: ptrn,
                patternData: ptrn,
                StartDate: startDateAt,
                GraceTime: graceDateAt,
                gameData: gameType
            };
            return res.render('GameManagement/gameAdd', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    editGameManagementPostData: async function(req, res) {
        try {

            console.log("editGamePostData", req.params);
            console.log("editGamePostData", req.body);

            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });
            let updateGame;

            if (gameType.type == "game_1") {

            } else if (gameType.type == "game_2") {
                updateGame = await Sys.App.Services.GameService.getSingleGameData({ _id: req.params.id });

                if (updateGame != undefined) {
                    let data = {
                        startDate: req.body.start_date,
                        graceDate: req.body.grace_time,
                        minTicketCount: req.body.minTicketCount,
                        totalNoTickets: req.body.totalNoTickets,
                        notificationStartTime: req.body.notificationStartTime,
                        luckyNumberPrize: req.body.luckyNumberPrize,
                        ticketPrice: req.body.ticketPrice,
                        seconds: req.body.seconds * 1000,
                        jackPotNumber: {
                            9: req.body.priceNine,
                            10: req.body.priceTen,
                            11: req.body.priceEleven,
                            12: req.body.priceTwelve,
                            13: req.body.priceThirteen,
                            1421: req.body.priceFourteenToTwentyone,
                        },
                    }
                    await Sys.App.Services.GameService.updateGameData({ _id: req.params.id }, data)
                    var gameType = await Sys.App.Services.GameService.getByIdGameType();
                }
            } else if (gameType.type == "game_3") {
                updateGame = await Sys.App.Services.GameService.getSingleGameData({ _id: req.params.id });

                if (updateGame != undefined) {
                    var patternGroupNumberPrize = [];
                    let data = {
                        startDate: req.body.start_date,
                        graceDate: req.body.grace_time,
                        minTicketCount: req.body.minTicketCount,
                        totalNoTickets: req.body.totalNoTickets,
                        notificationStartTime: req.body.notificationStartTime,
                        luckyNumberPrize: req.body.luckyNumberPrize,
                        ticketPrice: req.body.ticketPrice,
                        patternGroupNumberPrize: patternGroupNumberPrize,
                        seconds: req.body.seconds
                    }
                    await Sys.App.Services.GameService.updateGameData({ _id: req.params.id }, data)
                }
            } else if (gameType.type == "game_4") {

                updateGame = await Sys.App.Services.GameService.getSingleGameData({ _id: req.params.id });

                var newArrayBetAmount = req.body.betAmount.map(function(x) {
                    return parseInt(x, 10);
                });

                let n = 3; // [ Array Rows ]

                let arr1 = [];
                let arr2 = [];
                let arr3 = [];
                let arr4 = [];

                let cntt = 0;
                for (let i = 0; i < newArrayBetAmount.length; i++) {
                    let index = newArrayBetAmount.indexOf(newArrayBetAmount[i]);

                    if (cntt == n) {
                        arr1.push(newArrayBetAmount[i]);
                        cntt = 0;
                    } else if (cntt == (n - 1)) {
                        arr2.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    } else if (cntt == (n - 2)) {
                        arr3.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    } else {
                        arr4.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    }
                }

                let result = [
                    [...arr4],
                    [...arr3],
                    [...arr2],
                    [...arr1]
                ];
                console.log('Result: ', result);

                let json = {};
                for (let i = 0; i < 4; i++) {
                    json['ticket' + (i + 1) + 'Multiplier'] = result[i];
                }
                console.log("JSON: ", json);

                if (updateGame != undefined) {
                    game = await Sys.App.Services.GameService.updateGameData({ _id: req.params.id }, {
                        betAmount: req.body.betAmount,
                        ticketPrice: req.body.ticketPrice,
                        betMultiplier: req.body.betMultiplier,
                        betData: json,
                        seconds2: req.body.seconds2 * 1000,
                        seconds: req.body.seconds * 1000,
                        patternNamePrice: {
                            'Pattern1': req.body.Pattern1,
                            'Pattern2': req.body.Pattern2,
                            'Pattern3': req.body.Pattern3,
                            'Pattern4': req.body.Pattern4,
                            'Pattern5': req.body.Pattern5,
                            'Pattern6': req.body.Pattern6,
                            'Pattern7': req.body.Pattern7,
                            'Pattern8': req.body.Pattern8,
                            'Pattern9': req.body.Pattern9,
                            'Pattern10': req.body.Pattern10,
                            'Pattern11': req.body.Pattern11,
                            'Pattern12': req.body.Pattern12,
                            'Pattern13': req.body.Pattern13,
                            'Pattern14': req.body.Pattern14,
                            'Pattern15': req.body.Pattern15
                        }
                    });
                    console.log('game: ', game);
                }





            }

            if (!updateGame) {
                req.flash('error', 'Game was not updated');
                return res.redirect('/gameManagement');
            } else {
                req.flash('success', 'Game was updated successfully');
                return res.redirect('/gameManagement');
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    startGame: async function(req, res) {
        try {
            //console.log("req.body startGame", req.body);
            let game = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.id, status: 'active' });
            if (game) {
                if (game.purchasedTickets.length > 0 || game.gameType == 'game_1') {
                    if (game.gameMode == 'auto') {
                        if (game.minTicketCount <= game.purchasedTickets.length || game.gameType == 'game_1') {
                            console.log('<========================================================================================================================>');
                            console.log('<=>                                              || ' + game.gameName + ' Starting [ Admin Panel ] (Auto) ||                                                 <=>');
                            console.log('<========================================================================================================================>');

                            if (game.gameType == 'game_1') {
                                // game start from admin start for game 1
                                let isTicketAvailable = false;
                                let gameIds = [];
                                let allSubGames = await Sys.App.Services.GameService.getGameData({ parentGameId: req.body.id });
                                console.log("allSubGames", allSubGames)
                                if (allSubGames.length > 0) {
                                    for (let s = 0; s < allSubGames.length; s++) {
                                        gameIds.push(allSubGames[s]._id)
                                        if (allSubGames[s].subGames[0].options.length > 0) {
                                            for (let o = 0; o < allSubGames[s].subGames[0].options.length; o++) {
                                                console.log("tickets count", allSubGames[s].subGames[0].options[o].totalPurchasedTickets)
                                                if (allSubGames[s].subGames[0].options[o].totalPurchasedTickets < allSubGames[s].subGames[0].options[o].ticketCount) {
                                                    isTicketAvailable = true;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                } else {
                                    isTicketAvailable = true;
                                }

                                console.log("isTicketAvailable in startGame", isTicketAvailable)
                                if (isTicketAvailable == false) {
                                    gameIds.push(game._id);
                                    console.log("allGame ids", gameIds)


                                    let updatedGameData = {
                                        isAdminGameStart: true,
                                        startDate: Date.now()
                                    }
                                    await Sys.App.Services.GameService.updateManyGameData({ "_id": { $in: gameIds } }, updatedGameData);

                                    if (allSubGames.length > 0) {
                                        for (let s = 0; s < allSubGames.length; s++) {
                                            let playerIds = [];
                                            let bulkArr = [];
                                            let TimeMessage = allSubGames[s].gameNumber + " [ " + allSubGames[s].gameName + " ]  Game Start By Admin ..!! ";
                                            for (let p = 0; p < allSubGames[s].players.length; p++) {
                                                playerIds.push(allSubGames[s].players[p].id);
                                                let notification = {
                                                    notificationType: 'gameStartByAdmin',
                                                    message: TimeMessage
                                                }
                                                bulkArr.push({
                                                    insertOne: {
                                                        document: {
                                                            playerId: allSubGames[s].players[p].id,
                                                            gameId: allSubGames[s]._id,
                                                            notification: notification
                                                        }
                                                    }
                                                });
                                            }

                                            console.log("TimeMessage", TimeMessage)
                                            await Sys.Helper.gameHelper.sendNotificationToPlayers(allSubGames[s], playerIds, TimeMessage, 'gameStartByAdmin');
                                            await Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
                                        }
                                    }
                                    console.log("Auto game 1 start")
                                    if (allSubGames.length > 0) {
                                        for (let s = 0; s < allSubGames.length; s++) {
                                            Sys.Game.Game1.Controllers.GameProcess.StartGame(allSubGames[s].id);
                                        }
                                    }

                                    return res.send("success");
                                } else {
                                    return res.send("error");
                                }
                            } else if (game.gameType == 'game_2') {

                                for (let p = 0; p < game.players.length; p++) {

                                    let playerUpdated = await Sys.Game.Game2.Services.PlayerServices.getById(game.players[p].id);

                                    //if (playerUpdated.enableNotification == true) {

                                    let TimeMessage = game.gameNumber + " [ " + game.gameName + " ]  Game Start By Admin ..!! ";

                                    let notification = {
                                        notificationType: 'gameStartByAdmin',
                                        message: TimeMessage
                                    }

                                    let dataNotification = {
                                        playerId: game.players[p].id,
                                        gameId: game._id,
                                        notification: notification
                                    }

                                    await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                    Sys.Helper.gameHelper.sendNotificationToOnePlayer(game._id, game.players[p].id, TimeMessage, game.gameName, notification.notificationType);
                                    //}
                                }

                                let updatedGameData = {
                                    isAdminGameStart: true,
                                    startDate: Date.now()
                                }
                                await Sys.App.Services.GameService.updateGameData({ _id: game._id }, updatedGameData)

                                let newGame = await Sys.App.Services.GameService.getSingleGameData({ _id: game._id, status: 'active' });

                                await Sys.Game.Game2.Controllers.GameProcess.StartGame(newGame);
                                return res.send("success");
                            } else if (game.gameType == 'game_3') {

                                for (let p = 0; p < game.players.length; p++) {

                                    let playerUpdated = await Sys.Game.Game3.Services.PlayerServices.getById(game.players[p].id);

                                    //if (playerUpdated.enableNotification == true) {

                                    let TimeMessage = game.gameNumber + " [ " + game.gameName + " ]  Game Start By Admin ..!! ";

                                    let notification = {
                                        notificationType: 'gameStartByAdmin',
                                        message: TimeMessage
                                    }

                                    let dataNotification = {
                                        playerId: game.players[p].id,
                                        gameId: game._id,
                                        notification: notification
                                    }

                                    await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                    Sys.Helper.gameHelper.sendNotificationToOnePlayer(game._id, game.players[p].id, TimeMessage, game.gameName, notification.notificationType);
                                    //}
                                }

                                let updatedGameData = {
                                    isAdminGameStart: true,
                                    startDate: Date.now()
                                }
                                await Sys.App.Services.GameService.updateGameData({ _id: game._id }, updatedGameData)

                                let newGame = await Sys.App.Services.GameService.getSingleGameData({ _id: game._id, status: 'active' });

                                await Sys.Game.Game3.Controllers.GameProcess.StartGame(newGame);
                                return res.send("success");
                            }

                        } else {
                            return res.send("error");
                        }
                    } else if (game.gameMode == 'manual') {

                        if (game.purchasedTickets.length == game.totalNoTickets || game.gameType == 'game_1') {
                            console.log('<========================================================================================================================>');
                            console.log('<=>                                              || ' + game.gameName + ' Starting [ Admin Panel ] (Manual) ||                                                 <=>');
                            console.log('<========================================================================================================================>');

                            if (game.gameType == 'game_1') {
                                let isTicketAvailable = false;
                                let gameIds = [];
                                let allSubGames = await Sys.App.Services.GameService.getGameData({ parentGameId: req.body.id });
                                console.log("allSubGames", allSubGames)
                                if (allSubGames.length > 0) {
                                    for (let s = 0; s < allSubGames.length; s++) {
                                        gameIds.push(allSubGames[s]._id)
                                        if (allSubGames[s].subGames[0].options.length > 0) {
                                            for (let o = 0; o < allSubGames[s].subGames[0].options.length; o++) {
                                                console.log("tickets count", allSubGames[s].subGames[0].options[o].totalPurchasedTickets)
                                                if (allSubGames[s].subGames[0].options[o].totalPurchasedTickets < allSubGames[s].subGames[0].options[o].ticketCount) {
                                                    isTicketAvailable = true;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                } else {
                                    isTicketAvailable = true;
                                }

                                console.log("isTicketAvailable in startGame", isTicketAvailable)
                                if (isTicketAvailable == false) {
                                    gameIds.push(game._id);
                                    console.log("allGame ids", gameIds)


                                    let updatedGameData = {
                                        isAdminGameStart: true,
                                        startDate: Date.now()
                                    }
                                    await Sys.App.Services.GameService.updateManyGameData({ "_id": { $in: gameIds } }, updatedGameData);

                                    if (allSubGames.length > 0) {
                                        for (let s = 0; s < allSubGames.length; s++) {
                                            let playerIds = [];
                                            let bulkArr = [];
                                            let TimeMessage = allSubGames[s].gameNumber + " [ " + allSubGames[s].gameName + " ]  Game Start By Admin ..!! ";
                                            for (let p = 0; p < allSubGames[s].players.length; p++) {
                                                playerIds.push(allSubGames[s].players[p].id);
                                                let notification = {
                                                    notificationType: 'gameStartByAdmin',
                                                    message: TimeMessage
                                                }
                                                bulkArr.push({
                                                    insertOne: {
                                                        document: {
                                                            playerId: allSubGames[s].players[p].id,
                                                            gameId: allSubGames[s]._id,
                                                            notification: notification
                                                        }
                                                    }
                                                });
                                            }

                                            console.log("TimeMessage", TimeMessage)
                                            await Sys.Helper.gameHelper.sendNotificationToPlayers(allSubGames[s], playerIds, TimeMessage, 'gameStartByAdmin');
                                            await Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
                                        }
                                    }
                                    console.log("manual game 1 start")
                                    if (allSubGames.length > 0) {
                                        for (let s = 0; s < allSubGames.length; s++) {
                                            Sys.Game.Game1.Controllers.GameProcess.StartGame(allSubGames[s].id);
                                        }
                                    }
                                    //await Sys.Game.Game1.Controllers.GameProcess.StartGame(newGame);
                                    return res.send("success");
                                } else {
                                    return res.send("error");
                                }
                            } else if (game.gameType == 'game_2') {

                                for (let p = 0; p < game.players.length; p++) {

                                    let playerUpdated = await Sys.Game.Game2.Services.PlayerServices.getById(game.players[p].id);

                                    //if (playerUpdated.enableNotification == true) {

                                    let TimeMessage = game.gameNumber + " [ " + game.gameName + " ]  Game Start By Admin ..!! ";

                                    let notification = {
                                        notificationType: 'gameStartByAdmin',
                                        message: TimeMessage
                                    }

                                    let dataNotification = {
                                        playerId: game.players[p].id,
                                        gameId: game._id,
                                        notification: notification
                                    }

                                    await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                    Sys.Helper.gameHelper.sendNotificationToOnePlayer(game._id, game.players[p].id, TimeMessage, game.gameName, notification.notificationType);
                                    //}
                                }

                                let updatedGameData = {
                                    isAdminGameStart: true,
                                    startDate: Date.now()
                                }
                                await Sys.App.Services.GameService.updateGameData({ _id: game._id }, updatedGameData)

                                let newGame = await Sys.App.Services.GameService.getSingleGameData({ _id: game._id, status: 'active' });


                                await Sys.Game.Game2.Controllers.GameProcess.StartGame(newGame);
                                return res.send("success");
                            } else if (game.gameType == 'game_3') {

                                for (let p = 0; p < game.players.length; p++) {

                                    let playerUpdated = await Sys.Game.Game3.Services.PlayerServices.getById(game.players[p].id);

                                    //if (playerUpdated.enableNotification == true) {
                                    let TimeMessage = game.gameNumber + " [ " + game.gameName + " ]  Game Start By Admin ..!! ";

                                    let notification = {
                                        notificationType: 'gameStartByAdmin',
                                        message: TimeMessage
                                    }

                                    let dataNotification = {
                                        playerId: game.players[p].id,
                                        gameId: game._id,
                                        notification: notification
                                    }

                                    await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                    Sys.Helper.gameHelper.sendNotificationToOnePlayer(game._id, game.players[p].id, TimeMessage, game.gameName, notification.notificationType);
                                    //}
                                }

                                let updatedGameData = {
                                    isAdminGameStart: true,
                                    startDate: Date.now()
                                }
                                await Sys.App.Services.GameService.updateGameData({ _id: game._id }, updatedGameData)

                                let newGame = await Sys.App.Services.GameService.getSingleGameData({ _id: game._id, status: 'active' });


                                await Sys.Game.Game3.Controllers.GameProcess.StartGame(newGame);
                                return res.send("success");
                            }

                        } else {
                            return res.send("error");
                        }
                    }
                } else {
                    return res.send("error");
                }
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error in startGame", e);
            return new Error(e);
        }
    },

    getGameManagementDelete: async function(req, res) {
        try {
            let game = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.id, status: "active" });
            if (game || game.length > 0) {

                if (game.status == "active") {
                    if (game.gameMode == "auto") {

                        let startTime = new Date(game.startDate);
                        console.log("startTime startTime", startTime);
                        let currentTime = new Date(Date.now());
                        console.log("startTime currentTime", currentTime);
                        let diff = (currentTime.getTime() - startTime.getTime()) / 1000;
                        console.log("startTime before", diff);
                        diff /= 60;
                        console.log("startTime affter", diff);
                        let minutes = Math.abs(Math.round(diff));
                        console.log("minutes", minutes);

                        if (minutes <= 15) {
                            if (minutes <= 0) {

                                let startTimeGrace = new Date(game.graceDate);
                                let currentTimeGrace = new Date(Date.now());
                                let diffGrace = (currentTimeGrace.getTime() - startTimeGrace.getTime()) / 1000;
                                console.log("diffGrace before", diffGrace);
                                diffGrace /= 60;
                                console.log("diffGrace affter", diffGrace);
                                let minutesGraceDate = Math.abs(Math.round(diffGrace));
                                console.log("minutesGraceDate", minutesGraceDate);

                                if (minutesGraceDate <= 0 || minutesGraceDate > 15) {
                                    console.log('\x1b[36m%s\x1b[0m', 'Deleted by admin Auto Game Not Start [ Refund Process ]');
                                    // start
                                    if (game.gameType == "game_1") {
                                        let allSubGames = await Sys.App.Services.GameService.getGameData({ parentGameId: req.body.id, status: "active" });
                                        console.log("allSubGames", allSubGames)
                                        if (allSubGames.length > 0) {
                                            for (let s = 0; s < allSubGames.length; s++) {
                                                let ticketIdArray = [];
                                                if (allSubGames[s].purchasedTickets.length > 0) {
                                                    console.log('\x1b[36m%s\x1b[0m', 'Deleted by admin Manual Game Not Start [ Refund Process ] of manula game 1');
                                                    for (let i = 0; i < allSubGames[s].purchasedTickets.length; i++) {
                                                        //for (let j = 0; j < game.players.length; j++) {
                                                        //if (JSON.stringify(game.purchasedTickets[i].playerIdOfPurchaser) == JSON.stringify(game.players[j].id)) {

                                                        let transactionDataSend = {
                                                            playerId: allSubGames[s].purchasedTickets[i].playerIdOfPurchaser,
                                                            gameId: allSubGames[s]._id,
                                                            ticketId: allSubGames[s].purchasedTickets[i].ticketId,
                                                            transactionSlug: "refund",
                                                            action: "credit",
                                                            purchasedSlug: allSubGames[s].purchasedTickets[i].purchasedSlug,
                                                            totalAmount: (allSubGames[s].purchasedTickets[i].voucherId != '' && allSubGames[s].purchasedTickets[i].voucherId != null) ? allSubGames[s].purchasedTickets[i].isVoucherPayableAmount : allSubGames[s].purchasedTickets[i].totalAmount,
                                                        }
                                                        ticketIdArray.push(allSubGames[s].purchasedTickets[i].ticketParentId)
                                                        await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);

                                                        //}
                                                        //}
                                                    }
                                                }
                                                console.log("----ticketIdArray in game delete----", ticketIdArray)
                                                if (ticketIdArray.length > 0) {
                                                    Sys.Game.Game1.Services.GameServices.updateStaticGameCustom({ _id: { $in: ticketIdArray }, isPurchased: true }, { isPurchased: false, playerIdOfPurchaser: "" });
                                                }
                                                for (let p = 0; p < allSubGames[s].players.length; p++) {

                                                    let playerUpdated = await Sys.Game.Game2.Services.PlayerServices.getById(allSubGames[s].players[p].id);

                                                    //if (playerUpdated.enableNotification == true) {

                                                    let TimeMessage = allSubGames[s].gameNumber + " [ " + allSubGames[s].gameName + " ] Game Deleted By Admin So Refund your money/points ..!! ";

                                                    let notification = {
                                                        notificationType: 'gameDeletedByAdmin',
                                                        message: TimeMessage
                                                    }

                                                    let dataNotification = {
                                                        playerId: allSubGames[s].players[p].id,
                                                        gameId: allSubGames[s]._id,
                                                        notification: notification
                                                    }

                                                    await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                                    Sys.Helper.gameHelper.sendNotificationToOnePlayer(allSubGames[s]._id, allSubGames[s].players[p].id, TimeMessage, allSubGames[s].gameName, notification.notificationType);
                                                    //}

                                                    console.log("Games GameListRefresh to player :- ", playerUpdated.username, "with sokcetId", playerUpdated.socketId);
                                                    await Sys.Io.to(playerUpdated.socketId).emit('GameListRefresh', {
                                                        gameType: (allSubGames[s].gameType == 'game_1') ? 1 : (allSubGames[s].gameType == 'game_2') ? 2 : (allSubGames[s].gameType == 'game_3') ? 3 : 0
                                                    });


                                                    let ownPurchasedTicketCount = allSubGames[s].purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(allSubGames[s].players[p].id));

                                                    console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund ] ::--->> ", ownPurchasedTicketCount.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                                    let newPointArr = [];
                                                    let newRealArr = [];
                                                    for (let o = 0; o < ownPurchasedTicketCount.length; o++) {
                                                        if (ownPurchasedTicketCount[o].purchasedSlug == "points") {
                                                            newPointArr.push(ownPurchasedTicketCount[o]);
                                                        } else {
                                                            newRealArr.push(ownPurchasedTicketCount[o]);
                                                        }
                                                    }


                                                    console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Points ] ::--->> ", newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                                    console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Real ] ::--->> ", newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                                    if (newPointArr.length > 0) {

                                                        let newExtraTransaction = {
                                                            playerId: playerUpdated._id,
                                                            gameId: allSubGames[s]._id,
                                                            transactionSlug: "extraTransaction",
                                                            typeOfTransaction: "Refund",
                                                            action: "credit", // debit / credit
                                                            purchasedSlug: "points", // point /realMoney
                                                            totalAmount: newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                                        }

                                                        await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                                    }

                                                    if (newRealArr.length > 0) {

                                                        let newExtraTransaction = {
                                                            playerId: playerUpdated._id,
                                                            gameId: allSubGames[s]._id,
                                                            transactionSlug: "extraTransaction",
                                                            typeOfTransaction: "Refund",
                                                            action: "credit", // debit / credit
                                                            purchasedSlug: "realMoney", // point /realMoney
                                                            totalAmount: newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                                        }

                                                        await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                                    }

                                                }
                                                await Sys.App.Services.GameService.deleteGame(allSubGames[s]._id)
                                                Sys.App.Services.GameService.deleteTicketMany(allSubGames[s]._id);
                                            }

                                        } else {
                                            console.log("game 1 subgames not found");
                                        }
                                        await Sys.App.Services.GameService.deleteGame(req.body.id)
                                        return res.send("success");
                                    } else {
                                        for (var i = 0; i < game.purchasedTickets.length; i++) {
                                            for (let j = 0; j < game.players.length; j++) {
                                                if (JSON.stringify(game.purchasedTickets[i].playerIdOfPurchaser) == JSON.stringify(game.players[j].id)) {

                                                    var transactionDataSend = {
                                                        playerId: game.purchasedTickets[i].playerIdOfPurchaser,
                                                        gameId: game._id,
                                                        ticketId: game.purchasedTickets[i].ticketId,
                                                        transactionSlug: "refund",
                                                        action: "credit",
                                                        purchasedSlug: game.purchasedTickets[i].purchasedSlug,
                                                        totalAmount: game.ticketPrice,
                                                    }

                                                    await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);
                                                }
                                            }
                                        }
                                        var ticketData = await Sys.App.Services.GameService.deleteTicketMany(game._id);

                                        for (let p = 0; p < game.players.length; p++) {

                                            let playerUpdated = await Sys.Game.Game3.Services.PlayerServices.getById(game.players[p].id);

                                            //if (playerUpdated.enableNotification == true) {

                                            let TimeMessage = game.gameNumber + " [ " + game.gameName + " ] Game Deleted By Admin So Refund your money/points ..!! ";

                                            let notification = {
                                                notificationType: 'gameDeletedByAdmin',
                                                message: TimeMessage
                                            }

                                            let dataNotification = {
                                                playerId: game.players[p].id,
                                                gameId: game._id,
                                                notification: notification
                                            }

                                            await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                            Sys.Helper.gameHelper.sendNotificationToOnePlayer(game._id, game.players[p].id, TimeMessage, game.gameName, notification.notificationType);
                                            //}

                                            let ownPurchasedTicketCount = game.purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(game.players[p].id));

                                            console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund ] ::--->> ", ownPurchasedTicketCount.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                            let newPointArr = [];
                                            let newRealArr = [];
                                            for (let o = 0; o < ownPurchasedTicketCount.length; o++) {
                                                if (ownPurchasedTicketCount[o].purchasedSlug == "points") {
                                                    newPointArr.push(ownPurchasedTicketCount[o]);
                                                } else {
                                                    newRealArr.push(ownPurchasedTicketCount[o]);
                                                }
                                            }


                                            console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Points ] ::--->> ", newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                            console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Real ] ::--->> ", newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                            if (newPointArr.length > 0) {

                                                let newExtraTransaction = {
                                                    playerId: playerUpdated._id,
                                                    gameId: game._id,
                                                    transactionSlug: "extraTransaction",
                                                    typeOfTransaction: "Refund",
                                                    action: "credit", // debit / credit
                                                    purchasedSlug: "points", // point /realMoney
                                                    totalAmount: newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                                }

                                                await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                            }

                                            if (newRealArr.length > 0) {

                                                let newExtraTransaction = {
                                                    playerId: playerUpdated._id,
                                                    gameId: game._id,
                                                    transactionSlug: "extraTransaction",
                                                    typeOfTransaction: "Refund",
                                                    action: "credit", // debit / credit
                                                    purchasedSlug: "realMoney", // point /realMoney
                                                    totalAmount: newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                                }

                                                await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                            }

                                        }
                                        await Sys.App.Services.GameService.deleteGame(req.body.id)
                                        return res.send("success");
                                    }
                                    // end   
                                } else {
                                    return res.send("error");
                                }

                            } else {
                                return res.send("error");
                            }
                        } else {
                            if (game.gameType == "game_1") {
                                let allSubGames = await Sys.App.Services.GameService.getGameData({ parentGameId: req.body.id, status: "active" });
                                console.log("allSubGames", allSubGames)
                                if (allSubGames.length > 0) {
                                    for (let s = 0; s < allSubGames.length; s++) {
                                        let ticketIdArray = [];
                                        if (allSubGames[s].purchasedTickets.length > 0) {
                                            console.log('\x1b[36m%s\x1b[0m', 'Deleted by admin Manual Game Not Start [ Refund Process ] of manula game 1');
                                            for (let i = 0; i < allSubGames[s].purchasedTickets.length; i++) {
                                                //for (let j = 0; j < game.players.length; j++) {
                                                //if (JSON.stringify(game.purchasedTickets[i].playerIdOfPurchaser) == JSON.stringify(game.players[j].id)) {

                                                let transactionDataSend = {
                                                    playerId: allSubGames[s].purchasedTickets[i].playerIdOfPurchaser,
                                                    gameId: allSubGames[s]._id,
                                                    ticketId: allSubGames[s].purchasedTickets[i].ticketId,
                                                    transactionSlug: "refund",
                                                    action: "credit",
                                                    purchasedSlug: allSubGames[s].purchasedTickets[i].purchasedSlug,
                                                    totalAmount: (allSubGames[s].purchasedTickets[i].voucherId != '' && allSubGames[s].purchasedTickets[i].voucherId != null) ? allSubGames[s].purchasedTickets[i].isVoucherPayableAmount : allSubGames[s].purchasedTickets[i].totalAmount,
                                                }
                                                ticketIdArray.push(allSubGames[s].purchasedTickets[i].ticketParentId)
                                                await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);

                                                //}
                                                //}
                                            }
                                        }
                                        console.log("----ticketIdArray in game delete----", ticketIdArray)
                                        if (ticketIdArray.length > 0) {
                                            Sys.Game.Game1.Services.GameServices.updateStaticGameCustom({ _id: { $in: ticketIdArray }, isPurchased: true }, { isPurchased: false, playerIdOfPurchaser: "" });
                                        }
                                        for (let p = 0; p < allSubGames[s].players.length; p++) {

                                            let playerUpdated = await Sys.Game.Game2.Services.PlayerServices.getById(allSubGames[s].players[p].id);

                                            //if (playerUpdated.enableNotification == true) {

                                            let TimeMessage = allSubGames[s].gameNumber + " [ " + allSubGames[s].gameName + " ] Game Deleted By Admin So Refund your money/points ..!! ";

                                            let notification = {
                                                notificationType: 'gameDeletedByAdmin',
                                                message: TimeMessage
                                            }

                                            let dataNotification = {
                                                playerId: allSubGames[s].players[p].id,
                                                gameId: allSubGames[s]._id,
                                                notification: notification
                                            }

                                            await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                            Sys.Helper.gameHelper.sendNotificationToOnePlayer(allSubGames[s]._id, allSubGames[s].players[p].id, TimeMessage, allSubGames[s].gameName, notification.notificationType);
                                            //}

                                            console.log("Games GameListRefresh to player :- ", playerUpdated.username, "with sokcetId", playerUpdated.socketId);
                                            await Sys.Io.to(playerUpdated.socketId).emit('GameListRefresh', {
                                                gameType: (allSubGames[s].gameType == 'game_1') ? 1 : (allSubGames[s].gameType == 'game_2') ? 2 : (allSubGames[s].gameType == 'game_3') ? 3 : 0
                                            });


                                            let ownPurchasedTicketCount = allSubGames[s].purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(allSubGames[s].players[p].id));

                                            console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund ] ::--->> ", ownPurchasedTicketCount.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                            let newPointArr = [];
                                            let newRealArr = [];
                                            for (let o = 0; o < ownPurchasedTicketCount.length; o++) {
                                                if (ownPurchasedTicketCount[o].purchasedSlug == "points") {
                                                    newPointArr.push(ownPurchasedTicketCount[o]);
                                                } else {
                                                    newRealArr.push(ownPurchasedTicketCount[o]);
                                                }
                                            }


                                            console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Points ] ::--->> ", newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                            console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Real ] ::--->> ", newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                            if (newPointArr.length > 0) {

                                                let newExtraTransaction = {
                                                    playerId: playerUpdated._id,
                                                    gameId: allSubGames[s]._id,
                                                    transactionSlug: "extraTransaction",
                                                    typeOfTransaction: "Refund",
                                                    action: "credit", // debit / credit
                                                    purchasedSlug: "points", // point /realMoney
                                                    totalAmount: newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                                }

                                                await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                            }

                                            if (newRealArr.length > 0) {

                                                let newExtraTransaction = {
                                                    playerId: playerUpdated._id,
                                                    gameId: allSubGames[s]._id,
                                                    transactionSlug: "extraTransaction",
                                                    typeOfTransaction: "Refund",
                                                    action: "credit", // debit / credit
                                                    purchasedSlug: "realMoney", // point /realMoney
                                                    totalAmount: newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                                }

                                                await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                            }

                                        }
                                        await Sys.App.Services.GameService.deleteGame(allSubGames[s]._id)
                                        Sys.App.Services.GameService.deleteTicketMany(allSubGames[s]._id);
                                    }

                                } else {
                                    console.log("game 1 subgames not found");
                                }
                                await Sys.App.Services.GameService.deleteGame(req.body.id)
                                return res.send("success");
                            } else {
                                if (game.purchasedTickets.length > 0) {
                                    console.log('\x1b[36m%s\x1b[0m', 'Deleted by admin Auto Game Not Start [ Refund Process ]');
                                    for (var i = 0; i < game.purchasedTickets.length; i++) {
                                        for (let j = 0; j < game.players.length; j++) {
                                            if (JSON.stringify(game.purchasedTickets[i].playerIdOfPurchaser) == JSON.stringify(game.players[j].id)) {

                                                var transactionDataSend = {
                                                    playerId: game.purchasedTickets[i].playerIdOfPurchaser,
                                                    gameId: game._id,
                                                    ticketId: game.purchasedTickets[i].ticketId,
                                                    transactionSlug: "refund",
                                                    action: "credit",
                                                    purchasedSlug: game.purchasedTickets[i].purchasedSlug,
                                                    totalAmount: game.ticketPrice,
                                                }

                                                await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);


                                            }
                                        }
                                    }
                                }

                                for (let p = 0; p < game.players.length; p++) {

                                    let playerUpdated = await Sys.Game.Game3.Services.PlayerServices.getById(game.players[p].id);

                                    //if (playerUpdated.enableNotification == true) {
                                    let TimeMessage = game.gameNumber + " [ " + game.gameName + " ] Game Deleted By Admin So Refund your money/points ..!! ";

                                    let notification = {
                                        notificationType: 'gameDeletedByAdmin',
                                        message: TimeMessage
                                    }

                                    let dataNotification = {
                                        playerId: game.players[p].id,
                                        gameId: game._id,
                                        notification: notification
                                    }

                                    await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                    Sys.Helper.gameHelper.sendNotificationToOnePlayer(game._id, game.players[p].id, TimeMessage, game.gameName, notification.notificationType);
                                    //}

                                    console.log("Games GameListRefresh to player :- ", playerUpdated.username, "with sokcetId", playerUpdated.socketId);
                                    await Sys.Io.to(playerUpdated.socketId).emit('GameListRefresh', {
                                        gameType: (game.gameType == 'game_1') ? 1 : (game.gameType == 'game_2') ? 2 : (game.gameType == 'game_3') ? 3 : 0
                                    });


                                    let ownPurchasedTicketCount = game.purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(game.players[p].id));

                                    console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund ] ::--->> ", ownPurchasedTicketCount.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                    let newPointArr = [];
                                    let newRealArr = [];
                                    for (let o = 0; o < ownPurchasedTicketCount.length; o++) {
                                        if (ownPurchasedTicketCount[o].purchasedSlug == "points") {
                                            newPointArr.push(ownPurchasedTicketCount[o]);
                                        } else {
                                            newRealArr.push(ownPurchasedTicketCount[o]);
                                        }
                                    }


                                    console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Points ] ::--->> ", newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                    console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Real ] ::--->> ", newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                    if (newPointArr.length > 0) {

                                        let newExtraTransaction = {
                                            playerId: playerUpdated._id,
                                            gameId: game._id,
                                            transactionSlug: "extraTransaction",
                                            typeOfTransaction: "Refund",
                                            action: "credit", // debit / credit
                                            purchasedSlug: "points", // point /realMoney
                                            totalAmount: newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                        }

                                        await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                    }

                                    if (newRealArr.length > 0) {

                                        let newExtraTransaction = {
                                            playerId: playerUpdated._id,
                                            gameId: game._id,
                                            transactionSlug: "extraTransaction",
                                            typeOfTransaction: "Refund",
                                            action: "credit", // debit / credit
                                            purchasedSlug: "realMoney", // point /realMoney
                                            totalAmount: newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                        }

                                        await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                    }

                                }

                                var ticketData = await Sys.App.Services.GameService.deleteTicketMany(game._id);
                                await Sys.App.Services.GameService.deleteGame(req.body.id)
                                return res.send("success");
                            }

                        }
                    } else {
                        if (game.gameType == "game_1") {

                            let allSubGames = await Sys.App.Services.GameService.getGameData({ parentGameId: req.body.id, status: "active" });
                            console.log("allSubGames", allSubGames)
                            if (allSubGames.length > 0) {
                                for (let s = 0; s < allSubGames.length; s++) {
                                    let ticketIdArray = [];
                                    if (allSubGames[s].purchasedTickets.length > 0) {
                                        console.log('\x1b[36m%s\x1b[0m', 'Deleted by admin Manual Game Not Start [ Refund Process ] of manula game 1');
                                        for (let i = 0; i < allSubGames[s].purchasedTickets.length; i++) {
                                            //for (let j = 0; j < game.players.length; j++) {
                                            //if (JSON.stringify(game.purchasedTickets[i].playerIdOfPurchaser) == JSON.stringify(game.players[j].id)) {

                                            let transactionDataSend = {
                                                playerId: allSubGames[s].purchasedTickets[i].playerIdOfPurchaser,
                                                gameId: allSubGames[s]._id,
                                                ticketId: allSubGames[s].purchasedTickets[i].ticketId,
                                                transactionSlug: "refund",
                                                action: "credit",
                                                purchasedSlug: allSubGames[s].purchasedTickets[i].purchasedSlug,
                                                totalAmount: (allSubGames[s].purchasedTickets[i].voucherId != '' && allSubGames[s].purchasedTickets[i].voucherId != null) ? allSubGames[s].purchasedTickets[i].isVoucherPayableAmount : allSubGames[s].purchasedTickets[i].totalAmount,
                                            }
                                            ticketIdArray.push(allSubGames[s].purchasedTickets[i].ticketParentId)
                                            await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);

                                            //}
                                            //}
                                        }
                                    }
                                    console.log("----ticketIdArray in game delete----", ticketIdArray)
                                    if (ticketIdArray.length > 0) {
                                        Sys.Game.Game1.Services.GameServices.updateStaticGameCustom({ _id: { $in: ticketIdArray }, isPurchased: true }, { isPurchased: false, playerIdOfPurchaser: "" });
                                    }
                                    for (let p = 0; p < allSubGames[s].players.length; p++) {

                                        let playerUpdated = await Sys.Game.Game2.Services.PlayerServices.getById(allSubGames[s].players[p].id);

                                        //if (playerUpdated.enableNotification == true) {

                                        let TimeMessage = allSubGames[s].gameNumber + " [ " + allSubGames[s].gameName + " ] Game Deleted By Admin So Refund your money/points ..!! ";

                                        let notification = {
                                            notificationType: 'gameDeletedByAdmin',
                                            message: TimeMessage
                                        }

                                        let dataNotification = {
                                            playerId: allSubGames[s].players[p].id,
                                            gameId: allSubGames[s]._id,
                                            notification: notification
                                        }

                                        await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                        Sys.Helper.gameHelper.sendNotificationToOnePlayer(allSubGames[s]._id, allSubGames[s].players[p].id, TimeMessage, allSubGames[s].gameName, notification.notificationType);
                                        //}

                                        console.log("Games GameListRefresh to player :- ", playerUpdated.username, "with sokcetId", playerUpdated.socketId);
                                        await Sys.Io.to(playerUpdated.socketId).emit('GameListRefresh', {
                                            gameType: (allSubGames[s].gameType == 'game_1') ? 1 : (allSubGames[s].gameType == 'game_2') ? 2 : (allSubGames[s].gameType == 'game_3') ? 3 : 0
                                        });


                                        let ownPurchasedTicketCount = allSubGames[s].purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(allSubGames[s].players[p].id));

                                        console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund ] ::--->> ", ownPurchasedTicketCount.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                        let newPointArr = [];
                                        let newRealArr = [];
                                        for (let o = 0; o < ownPurchasedTicketCount.length; o++) {
                                            if (ownPurchasedTicketCount[o].purchasedSlug == "points") {
                                                newPointArr.push(ownPurchasedTicketCount[o]);
                                            } else {
                                                newRealArr.push(ownPurchasedTicketCount[o]);
                                            }
                                        }


                                        console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Points ] ::--->> ", newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                        console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Real ] ::--->> ", newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                        if (newPointArr.length > 0) {

                                            let newExtraTransaction = {
                                                playerId: playerUpdated._id,
                                                gameId: allSubGames[s]._id,
                                                transactionSlug: "extraTransaction",
                                                typeOfTransaction: "Refund",
                                                action: "credit", // debit / credit
                                                purchasedSlug: "points", // point /realMoney
                                                totalAmount: newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                            }

                                            await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                        }

                                        if (newRealArr.length > 0) {

                                            let newExtraTransaction = {
                                                playerId: playerUpdated._id,
                                                gameId: allSubGames[s]._id,
                                                transactionSlug: "extraTransaction",
                                                typeOfTransaction: "Refund",
                                                action: "credit", // debit / credit
                                                purchasedSlug: "realMoney", // point /realMoney
                                                totalAmount: newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                            }

                                            await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                        }

                                    }
                                    await Sys.App.Services.GameService.deleteGame(allSubGames[s]._id)
                                    Sys.App.Services.GameService.deleteTicketMany(allSubGames[s]._id);
                                }

                            } else {
                                console.log("game 1 subgames not found");
                            }

                        } else {
                            if (game.purchasedTickets.length > 0) {
                                console.log('\x1b[36m%s\x1b[0m', 'Deleted by admin Manual Game Not Start [ Refund Process ]');
                                for (var i = 0; i < game.purchasedTickets.length; i++) {
                                    for (let j = 0; j < game.players.length; j++) {
                                        if (JSON.stringify(game.purchasedTickets[i].playerIdOfPurchaser) == JSON.stringify(game.players[j].id)) {

                                            var transactionDataSend = {
                                                playerId: game.purchasedTickets[i].playerIdOfPurchaser,
                                                gameId: game._id,
                                                ticketId: game.purchasedTickets[i].ticketId,
                                                transactionSlug: "refund",
                                                action: "credit",
                                                purchasedSlug: game.purchasedTickets[i].purchasedSlug,
                                                totalAmount: game.ticketPrice,
                                            }

                                            await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);

                                        }
                                    }
                                }
                            }

                            for (let p = 0; p < game.players.length; p++) {

                                let playerUpdated = await Sys.Game.Game2.Services.PlayerServices.getById(game.players[p].id);

                                //if (playerUpdated.enableNotification == true) {

                                let TimeMessage = game.gameNumber + " [ " + game.gameName + " ] Game Deleted By Admin So Refund your money/points ..!! ";

                                let notification = {
                                    notificationType: 'gameDeletedByAdmin',
                                    message: TimeMessage
                                }

                                let dataNotification = {
                                    playerId: game.players[p].id,
                                    gameId: game._id,
                                    notification: notification
                                }

                                await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                Sys.Helper.gameHelper.sendNotificationToOnePlayer(game._id, game.players[p].id, TimeMessage, game.gameName, notification.notificationType);
                                //}

                                console.log("Games GameListRefresh to player :- ", playerUpdated.username, "with sokcetId", playerUpdated.socketId);
                                await Sys.Io.to(playerUpdated.socketId).emit('GameListRefresh', {
                                    gameType: (game.gameType == 'game_1') ? 1 : (game.gameType == 'game_2') ? 2 : (game.gameType == 'game_3') ? 3 : 0
                                });


                                let ownPurchasedTicketCount = game.purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(game.players[p].id));

                                console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund ] ::--->> ", ownPurchasedTicketCount.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                let newPointArr = [];
                                let newRealArr = [];
                                for (let o = 0; o < ownPurchasedTicketCount.length; o++) {
                                    if (ownPurchasedTicketCount[o].purchasedSlug == "points") {
                                        newPointArr.push(ownPurchasedTicketCount[o]);
                                    } else {
                                        newRealArr.push(ownPurchasedTicketCount[o]);
                                    }
                                }


                                console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Points ] ::--->> ", newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Real ] ::--->> ", newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                if (newPointArr.length > 0) {

                                    let newExtraTransaction = {
                                        playerId: playerUpdated._id,
                                        gameId: game._id,
                                        transactionSlug: "extraTransaction",
                                        typeOfTransaction: "Refund",
                                        action: "credit", // debit / credit
                                        purchasedSlug: "points", // point /realMoney
                                        totalAmount: newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                    }

                                    await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                }

                                if (newRealArr.length > 0) {

                                    let newExtraTransaction = {
                                        playerId: playerUpdated._id,
                                        gameId: game._id,
                                        transactionSlug: "extraTransaction",
                                        typeOfTransaction: "Refund",
                                        action: "credit", // debit / credit
                                        purchasedSlug: "realMoney", // point /realMoney
                                        totalAmount: newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                    }

                                    await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                }

                            }
                            let ticketData = await Sys.App.Services.GameService.deleteTicketMany(game._id);
                        }



                        await Sys.App.Services.GameService.deleteGame(req.body.id)
                        return res.send("success");
                    }
                }
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    viewGameManagementDetails: async function(req, res) {
        try {

            let subGameList = await Sys.App.Services.subGame1Services.getAllDataSelect({ status: 'active' }, { ticketColor: 1, gameName: 1, subGameId: 1, gameType: 1, allPatternRowId: 1 });
            let subGameColorRow = {};
            let rows = [];
            for (let s = 0; s < subGameList.length; s++) {
                for (let r = 0; r < subGameList[s].allPatternRowId.length; r++) {
                    rows.push(subGameList[s].allPatternRowId[r])
                }
            }
            for (let s = 0; s < subGameList.length; s++) {
                let obj = {};
                obj.colors = subGameList[s].ticketColor;
                obj.gameName = subGameList[s].gameName;
                obj.subGameId = subGameList[s].subGameId;
                obj.gameType = subGameList[s].gameType;
                subGameColorRow[subGameList[s].gameName] = obj;
            }

            //console.log("subGameColorRow subGameColorRow  subGameList : ", subGameList)




            let dataGame = await Sys.App.Services.GameService.getById({ _id: req.params.id });
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });
            //console.log(" dataGame dataGame dataGame : ", dataGame)
            var startDateAt = dateTimeFunction(dataGame.startDate);
            var graceDateAt = dateTimeFunction(dataGame.graceDate);

            function dateTimeFunction(dateData) {
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
                let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes + ' ' + ampm;
                return dateTime; // Function returns the dateandtime
            }

           // console.log("gameName dataGame dataGame", dataGame);
            let ptrn, arr = [];
            let theadField = [];
            if (dataGame.gameName == 'Game1') {
                theadField = [
                    'Player Name',
                    'User Type',
                    'Start Date & Time',
                    'Game Name',
                    'Ticket Color/Type',
                    'Ticket Number',
                    'Ticket Price',
                    'Ticket Purchased From',
                   // 'Ticket Win in Wallet/Points',
                    'Winning Row',
                    'Total Winning',
                    //'Remark',
                    'Spin Wheel Winnings',
                    'Treasure Chest Winnings',
                    'Mystry Winnings',
                    'Action'
                ]
            } else if (dataGame.gameName == 'Game2') {
                theadField = [
                    'Player Name',
                    'User Type',
                    'Start Date & Time',
                    'Ticket Number',
                    'Ticket Price',
                    'Ticket Win in Wallet/Points',
                    'Winning On Jackpot Number',
                    'Total Winning',
                    'After Balance',
                    'Remark',
                    'Action'
                ]
            } else if (dataGame.gameName == 'Game3') {
                theadField = [
                    'Player Name',
                    'User Type',
                    'Start Date & Time',
                    'Ticket Number',
                    'Ticket Price',
                    'Ticket Win in Wallet/Points',
                    'Winning Pattern',
                    'Total Winning',
                    'Remark',
                    'Action'
                ]
            } else if (dataGame.gameName == 'Game4') {
                theadField = [
                    'Player Name',
                    'User Type',
                    'Winning Pattern',
                    'Total Winning',
                ]

                ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_4" });

                arr = ['Pattern1', 'Pattern2', 'Pattern3', 'Pattern4', 'Pattern5', 'Pattern6', 'Pattern7', 'Pattern8', 'Pattern9', 'Pattern10', 'Pattern11', 'Pattern12', 'Pattern13', 'Pattern14', 'Pattern15']

                let printDataPattern = dataGame.patternNamePrice[0];
                for (let i = 0; i < ptrn.length; i++) {
                    ptrn[i].name = arr[i];
                    ptrn[i].price = printDataPattern['Pattern' + (i + 1)];
                }
            }

            let rowPatternData = [];
            let jackpot = [];
            let subGameNameArr = [];
            let subGamesTicketCount = [];
            if (dataGame.gameName == "Game1") {

                // Only Game Names
                dataGame.subGames.forEach(element => {
                    subGameNameArr.push(element.gameName);
                });

                // Row Pattern + Jackpot
                let GameRowPattern = dataGame.subGames;

               // console.log(" GameRowPattern GameRowPattern Game1 Game1 : ", GameRowPattern)

                for (let i = 0; i < GameRowPattern.length; i++) {
                    let jackpotObj = {}

                    let saveObj = {
                        gameName: GameRowPattern[i].gameName
                    }

                    let optionArraw = [];
                    for (let j = 0; j < GameRowPattern[i].options.length; j++) {
                        let option = {
                            ticketName: GameRowPattern[i].options[j].ticketName,
                        }

                        if (GameRowPattern[i].options[j].winning.row1) {
                            option.row1 = GameRowPattern[i].options[j].winning.row1;
                        }

                        if (GameRowPattern[i].options[j].winning.row2) {
                            option.row2 = GameRowPattern[i].options[j].winning.row2;
                        }

                        if (GameRowPattern[i].options[j].winning.row3) {
                            option.row3 = GameRowPattern[i].options[j].winning.row3;
                        }

                        if (GameRowPattern[i].options[j].winning.row4) {
                            option.row4 = GameRowPattern[i].options[j].winning.row4;
                        }

                        if (GameRowPattern[i].options[j].winning.row5) {
                            option.row5 = GameRowPattern[i].options[j].winning.row5;
                        }

                        if (GameRowPattern[i].options[j].winning.bingo) {
                            option.bingo = GameRowPattern[i].options[j].winning.bingo;
                        }
                        optionArraw.push(option);
                    }

                    saveObj.options = optionArraw;

                    rowPatternData.push(saveObj);

                    jackpotObj = {
                        gameName: GameRowPattern[i].gameName,
                        jackpotDraw: ((GameRowPattern[i].options.length > 0) ? GameRowPattern[i].options[0].jackpot.draw : '-'),
                        jackpotPrize: ((GameRowPattern[i].options.length > 0) ? GameRowPattern[i].options[0].jackpot.price : '-'),
                    }

                    jackpot.push(jackpotObj);
                }

                // Ticket Create and it's price
                for (let j = 0; j < GameRowPattern.length; j++) {
                    let subGamesTicketCountObj = {}
                    let optionArr = [];
                    for (let k = 0; k < GameRowPattern[j].options.length; k++) {
                        let optionObj = {
                            ticketType: GameRowPattern[j].options[k].ticketName,
                            ticketCount: GameRowPattern[j].options[k].ticketCount,
                            ticketPrice: GameRowPattern[j].options[k].ticketPrice,
                        }
                        optionArr.push(optionObj);
                    }

                    subGamesTicketCountObj.gameName = GameRowPattern[j].gameName;
                    subGamesTicketCountObj.optionList = optionArr;
                    subGamesTicketCount.push(subGamesTicketCountObj);
                }
            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameMenu: 'active',
                Game: dataGame,
                DisplayBall: dataGame.history.number,
                StartDate: startDateAt,
                GraceTime: graceDateAt,
                gameData: gameType,
                patternData: (ptrn) ? ptrn : [],
                theadField: theadField,
                subGameNameArr: subGameNameArr,
                rowPatternData: rowPatternData,
                jackpot: jackpot,
                subGamesTicketCount: subGamesTicketCount,
                subGameColorRow: subGameColorRow
            };
            return res.render('GameManagement/gameView', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    viewPhysicalGameHistory: async function(req, res) {
        try {
            console.log("viewPhysicalGameHistory ::>>", req.query);

            let order = req.query.order;
            let sort = {};
            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1
                }
            }
            //console.log("sort", sort);
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            var gameName;
            let query = { _id: req.params.id };
            // if (search != '') {
            //     query = { gameNumber: { $regex: '.*' + search + '.*' }, gameName: gameName, status: "active" };
            // }

            let data = await Sys.App.Services.GameService.getById(query);
            var dataGame = {};
            let gameData = [];
            let gameTransactionHistory;
            if (req.params.gameName == "Game1") {
                gameTransactionHistory = await Sys.App.Services.transactionServices.getByData({
                    gameId: data._id,
                });
                var dataGame = {
                    // _id: data._id,
                    // playerName: "",
                    // UserType: "",
                    // startDate: "",
                    // ticketNumber: "",
                    // ticketPrice: "",
                    // ticketPurchasedform: "",
                    // winnigPattern: "",
                    // totalWinning: "",
                    // ticketId: ""
                }
                gameData.push(gameTransactionHistory);

            } else if (req.params.gameName == "Game2") {
                gameTransactionHistory = await Sys.App.Services.transactionServices.getByData({
                    gameId: data._id,
                });
                for (var i = 0; i < gameTransactionHistory.length; i++) {
                    if (gameTransactionHistory[i].defineSlug == "buyTicket") {
                        continue;
                    }

                    if (gameTransactionHistory[i].defineSlug == "autoTicket") {
                        continue;
                    }

                    if (gameTransactionHistory[i].defineSlug == "cancelTicket") {
                        continue;
                    }

                    if (gameTransactionHistory[i].defineSlug == "refund") {
                        continue;
                    }

                    dataGame = {
                        _id: data._id,
                        playerName: gameTransactionHistory[i].playerName,
                        UserType: 'Apk',
                        startDate: data.startDate,
                        ticketNumber: gameTransactionHistory[i].ticketNumber,
                        ticketPrice: Number(data.ticketPrice),
                        ticketPurchasedform: gameTransactionHistory[i].amtCategory,
                        defineSlug: gameTransactionHistory[i].defineSlug,
                        winningJackpotNumber: (typeof gameTransactionHistory[i].winningJackpotNumber !== "undefined") ? Number(gameTransactionHistory[i].winningJackpotNumber) : '--',
                        totalWinning: (typeof gameTransactionHistory[i].winningPrice !== "undefined") ? eval(parseFloat(gameTransactionHistory[i].winningPrice).toFixed(2)) : '--',
                        afterBalance: Number(gameTransactionHistory[i].afterBalance),
                        remark: gameTransactionHistory[i].remark,
                        ticketId: gameTransactionHistory[i].ticketId
                    }
                    gameData.push(dataGame);
                }
            } else if (req.params.gameName == "Game3") {
                dataGame = {}
                gameTransactionHistory = await Sys.App.Services.transactionServices.getByData({
                    gameId: data._id,
                });
                var patternHistoryWinner = data.patternWinnerHistory;
                for (var i = 0; i < gameTransactionHistory.length; i++) {

                    if (gameTransactionHistory[i].defineSlug == "buyTicket") {
                        continue;
                    }

                    if (gameTransactionHistory[i].defineSlug == "cancelTicket") {
                        continue;
                    }

                    if (gameTransactionHistory[i].defineSlug == "refund") {
                        continue;
                    }


                    dataGame = {
                        _id: data._id,
                        playerName: gameTransactionHistory[i].playerName,
                        UserType: 'Apk',
                        startDate: data.startDate,
                        ticketNumber: gameTransactionHistory[i].ticketNumber,
                        ticketPrice: Number(data.ticketPrice),
                        defineSlug: gameTransactionHistory[i].defineSlug,
                        ticketPurchasedform: gameTransactionHistory[i].amtCategory,
                        winningPattern: (patternHistoryWinner.filter(obj => JSON.stringify(obj.ticketId) == JSON.stringify(gameTransactionHistory[i].ticketId)).length > 0) ? patternHistoryWinner[0].patternName : "--",
                        totalWinning: (patternHistoryWinner.filter(obj => JSON.stringify(obj.ticketId) == JSON.stringify(gameTransactionHistory[i].ticketId)).length > 0) ? eval(parseFloat(patternHistoryWinner[0].patternPrize).toFixed(2)) : (typeof gameTransactionHistory[i].winningPrice !== "undefined") ? eval(parseFloat(gameTransactionHistory[i].winningPrice).toFixed(2)) : '--',
                        remark: gameTransactionHistory[i].remark,
                        ticketId: gameTransactionHistory[i].ticketId
                    }
                    gameData.push(dataGame);

                }
            } else if (req.params.gameName == "Game4") {
                let subGameData = await Sys.App.Services.GameService.getBySubGameData({ parentGameId: data._id, status: "finish" });
                for (let j = 0; j < subGameData.length; j++) {
                    gameTransactionHistory = await Sys.App.Services.transactionServices.getByDataNew({
                        gameId: subGameData[j]._id,
                    });
                    for (var i = 0; i < gameTransactionHistory.length; i++) {
                        if (gameTransactionHistory[i].defineSlug == "buyTicket") {
                            continue;
                        }

                        if (gameTransactionHistory[i].defineSlug == "treasureChest") {
                            continue;
                        }

                        if (gameTransactionHistory[i].defineSlug == "mystery") {
                            continue;
                        }

                        if (gameTransactionHistory[i].defineSlug == "Spin") {
                            continue;
                        }

                        dataGame = {
                            playerName: gameTransactionHistory[i].playerName,
                            UserType: 'Apk',
                            defineSlug: gameTransactionHistory[i].defineSlug,
                            winningPattern: gameTransactionHistory[i].patternName,
                            totalWinning: eval(parseFloat(gameTransactionHistory[i].winningPrice).toFixed(2)),
                        }
                        gameData.push(dataGame);
                    }
                }
            }

            function limit(c) {
                return this.filter((x, i) => {
                    if (i <= (c - 1)) { return true }
                })
            }

            Array.prototype.limit = limit;

            function skip(c) {
                return this.filter((x, i) => {
                    if (i > (c - 1)) { return true }
                })
            }

            Array.prototype.skip = skip;

            function compareValues(key, order = 'asc') {
                return function innerSort(a, b) {
                    if (!a.hasOwnProperty(key) || !b.hasOwnProperty(key)) {
                        // property doesn't exist on either object
                        return 0;
                    }

                    const varA = (typeof a[key] === 'string') ?
                        a[key].toUpperCase() : a[key];
                    const varB = (typeof b[key] === 'string') ?
                        b[key].toUpperCase() : b[key];

                    let comparison = 0;
                    if (varA > varB) {
                        comparison = 1;
                    } else if (varA < varB) {
                        comparison = -1;
                    }
                    return (
                        (order === 'desc') ? (comparison * -1) : comparison
                    );
                };
            }

            console.log("sort", sort);

            let keyData = Object.keys(sort);
            let valueData = Object.values(sort);
            console.log("keyData", keyData[0]);
            console.log("valueData", valueData[0]);


            if (valueData[0] == 1) {
                gameData.sort(compareValues(keyData));
            } else if (valueData[0] == -1) {
                gameData.sort(compareValues(keyData, 'desc'));
            }


            let filtered = gameData.skip(start).limit(length);


            if (req.params.gameName == "Game1") {
                if (filtered[0].length === 0) {
                    filtered = [];
                }
            }

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': (req.params.gameName == "Game4") ? gameData.length : (filtered.length > 0) ? filtered.length : 0,
                'recordsFiltered': (req.params.gameName == "Game4") ? gameData.length : (filtered.length > 0) ? filtered.length : 0,
                'data': filtered,
            };

            res.send(obj);

        } catch (e) {
            console.log("Error", e);
        }
    },

    viewGameHistory: async function(req, res) {
        try {
            //console.log("viewGameHistory ::>>", req.query);
            let order = req.query.order;
            let sort = {};
            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1
                }
            }
            //console.log("sort", sort);
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            var gameName;
            let query = { _id: req.params.id };
            // if (search != '') {
            //     query = { gameNumber: { $regex: '.*' + search + '.*' }, gameName: gameName, status: "active" };
            // }

            let data = await Sys.App.Services.GameService.getById(query);
            var dataGame = {};
            let gameData = [];
            let gameTransactionHistory;
            let ticketsCount = 0;
            if (req.params.gameName == "Game1") {
                /*gameTransactionHistory = await Sys.App.Services.transactionServices.getByData({
                    gameId: data._id,
                });
                var dataGame = {
                    // _id: data._id,
                    // playerName: "",
                    // UserType: "",
                    // startDate: "",
                    // ticketNumber: "",
                    // ticketPrice: "",
                    // ticketPurchasedform: "",
                    // winnigPattern: "",
                    // totalWinning: "",
                    // ticketId: ""
                }
                gameData.push(gameTransactionHistory);*/

                // game 1 ticket history with winnings
                if(sort.totalWinning){
                    sort = { 'winningStats.finalWonAmount':  sort.totalWinning}
                }
                if(sort.wofWinners){
                    sort = { 'wofWinners.WinningAmount':  sort.wofWinners}
                }
                console.log("length, start, sort", length, start, sort)
                let data = await Sys.App.Services.GameService.getById({_id: "60c6fc2b8b98cf5a0f1a257d"});
                ticketsCount = await Sys.App.Services.GameService.getTicketCount({gameId: "60c6fc2b8b98cf5a0f1a257d"});
                let ticketInfo = await Sys.App.Services.GameService.getTicketDatatable({gameId:"60c6fc2b8b98cf5a0f1a257d"},length, start, sort);
                
                if(ticketInfo.length>0)
                {   
                    for(let j=0; j<ticketInfo.length;j++){
                        let amount=0;
                        //let ticketPurchasedform = 'realMoney'
                        if(ticketInfo[j].winningStats){
                            amount = ticketInfo[j].winningStats.finalWonAmount;
                            winningLine = ticketInfo[j].winningStats.lineTypeArray;    
                            //ticketPurchasedform = ticketInfo[j].winningStats.walletType; 
                        }
                        // let remark = "loss"
                        // if(ticketInfo[j].isPlayerWon==true){
                        //     remark = "Won"
                        // }
                        let userType = "-";
                        if(ticketInfo[j].userType){
                            userType = ticketInfo[j].userType;
                        }
                        if(ticketInfo[j].userType == "Online"){
                            userType = "Online User";
                        }
                        let winningPattern = ticketInfo[j].winningStats;
                        console.log("winningPattern", winningPattern);
                        if(winningPattern){
                            if(ticketInfo[j].bonusWinningStats){
                                if(ticketInfo[j].bonusWinningStats.wonAmount > 0){
                                    amount +=  +ticketInfo[j].bonusWinningStats.wonAmount;
                                    winningPattern.lineTypeArray.push({ lineType: ticketInfo[j].bonusWinningStats.lineType, wonAmount: ticketInfo[j].bonusWinningStats.wonAmount })
                                } 
                            }

                            // if(ticketInfo[j].tChestWinners.length > 0){
                            //     if(ticketInfo[j].tChestWinners[0].WinningAmount > 0){
                            //         amount +=  +ticketInfo[j].tChestWinners[0].WinningAmount;
                            //         winningPattern.lineTypeArray.push({ lineType: "Treasure Chest Extra Winning", wonAmount: ticketInfo[j].tChestWinners[0].WinningAmount })
                            //     } 
                            // }

                            // if(ticketInfo[j].mystryWinners.length > 0){
                            //     if(ticketInfo[j].mystryWinners[0].WinningAmount > 0){
                            //         amount +=  +ticketInfo[j].mystryWinners[0].WinningAmount;
                            //         winningPattern.lineTypeArray.push({ lineType: "Mystry Extra Winning", wonAmount: ticketInfo[j].mystryWinners[0].WinningAmount })
                            //     } 
                            // }
                        }

                        let wofWinners = "-";
                        if(ticketInfo[j].wofWinners && ticketInfo[j].wofWinners.length > 0){
                            wofWinners = ticketInfo[j].wofWinners[0].WinningAmount;
                        }

                        let tChestWinners = "-";
                        if(ticketInfo[j].tChestWinners && ticketInfo[j].tChestWinners.length > 0){
                            tChestWinners = ticketInfo[j].tChestWinners[0].WinningAmount;
                        }

                        let mystryWinners = "-";
                        if(ticketInfo[j].mystryWinners && ticketInfo[j].mystryWinners.length > 0){
                            mystryWinners = ticketInfo[j].mystryWinners[0].WinningAmount;
                        }
                        
                        let dataGame = {
                            _id             : ticketInfo[j]._id,
                            playerNameOfPurchaser      : ticketInfo[j].playerNameOfPurchaser,
                            UserType        : userType,
                            startDate       : data.startDate,
                            ticketId    : ticketInfo[j].ticketId,
                            ticketPrice     : ticketInfo[j].ticketPrice,
                            ticketPurchasedFrom: ticketInfo[j].ticketPurchasedFrom,
                            //remark          : remark,
                            winnigPattern   : ticketInfo[j].winningStats, 
                            totalWinning    : amount, 
                            ticketColorType     : ticketInfo[j].ticketColorType,  
                            gameName       : data.subGames[0].gameName,
                            wofWinners: wofWinners,
                            tChestWinners: tChestWinners,
                            mystryWinners: mystryWinners
                        }
                        gameData.push(dataGame);                    
                    }
                }

                console.log("gameData", dataGame)

            } else if (req.params.gameName == "Game2") {
                gameTransactionHistory = await Sys.App.Services.transactionServices.getByData({
                    gameId: data._id,
                });
                for (var i = 0; i < gameTransactionHistory.length; i++) {
                    if (gameTransactionHistory[i].defineSlug == "buyTicket") {
                        continue;
                    }

                    if (gameTransactionHistory[i].defineSlug == "autoTicket") {
                        continue;
                    }

                    if (gameTransactionHistory[i].defineSlug == "cancelTicket") {
                        continue;
                    }

                    if (gameTransactionHistory[i].defineSlug == "refund") {
                        continue;
                    }

                    dataGame = {
                        _id: data._id,
                        playerName: gameTransactionHistory[i].playerName,
                        UserType: 'Apk',
                        startDate: data.startDate,
                        ticketNumber: gameTransactionHistory[i].ticketNumber,
                        ticketPrice: Number(data.ticketPrice),
                        ticketPurchasedform: gameTransactionHistory[i].amtCategory,
                        defineSlug: gameTransactionHistory[i].defineSlug,
                        winningJackpotNumber: (typeof gameTransactionHistory[i].winningJackpotNumber !== "undefined") ? Number(gameTransactionHistory[i].winningJackpotNumber) : '--',
                        totalWinning: (typeof gameTransactionHistory[i].winningPrice !== "undefined") ? eval(parseFloat(gameTransactionHistory[i].winningPrice).toFixed(2)) : '--',
                        afterBalance: Number(gameTransactionHistory[i].afterBalance),
                        remark: gameTransactionHistory[i].remark,
                        ticketId: gameTransactionHistory[i].ticketId
                    }
                    gameData.push(dataGame);
                }
            } else if (req.params.gameName == "Game3") {
                dataGame = {}
                gameTransactionHistory = await Sys.App.Services.transactionServices.getByData({
                    gameId: data._id,
                });
                var patternHistoryWinner = data.patternWinnerHistory;
                for (var i = 0; i < gameTransactionHistory.length; i++) {

                    if (gameTransactionHistory[i].defineSlug == "buyTicket") {
                        continue;
                    }

                    if (gameTransactionHistory[i].defineSlug == "cancelTicket") {
                        continue;
                    }

                    if (gameTransactionHistory[i].defineSlug == "refund") {
                        continue;
                    }


                    dataGame = {
                        _id: data._id,
                        playerName: gameTransactionHistory[i].playerName,
                        UserType: 'Apk',
                        startDate: data.startDate,
                        ticketNumber: gameTransactionHistory[i].ticketNumber,
                        ticketPrice: Number(data.ticketPrice),
                        defineSlug: gameTransactionHistory[i].defineSlug,
                        ticketPurchasedform: gameTransactionHistory[i].amtCategory,
                        winningPattern: (patternHistoryWinner.filter(obj => JSON.stringify(obj.ticketId) == JSON.stringify(gameTransactionHistory[i].ticketId)).length > 0) ? patternHistoryWinner[0].patternName : "--",
                        totalWinning: (patternHistoryWinner.filter(obj => JSON.stringify(obj.ticketId) == JSON.stringify(gameTransactionHistory[i].ticketId)).length > 0) ? eval(parseFloat(patternHistoryWinner[0].patternPrize).toFixed(2)) : (typeof gameTransactionHistory[i].winningPrice !== "undefined") ? eval(parseFloat(gameTransactionHistory[i].winningPrice).toFixed(2)) : '--',
                        remark: gameTransactionHistory[i].remark,
                        ticketId: gameTransactionHistory[i].ticketId
                    }
                    gameData.push(dataGame);

                }
            } else if (req.params.gameName == "Game4") {
                let subGameData = await Sys.App.Services.GameService.getBySubGameData({ parentGameId: data._id, status: "finish" });
                for (let j = 0; j < subGameData.length; j++) {
                    gameTransactionHistory = await Sys.App.Services.transactionServices.getByDataNew({
                        gameId: subGameData[j]._id,
                    });
                    for (var i = 0; i < gameTransactionHistory.length; i++) {
                        if (gameTransactionHistory[i].defineSlug == "buyTicket") {
                            continue;
                        }

                        if (gameTransactionHistory[i].defineSlug == "treasureChest") {
                            continue;
                        }

                        if (gameTransactionHistory[i].defineSlug == "mystery") {
                            continue;
                        }

                        if (gameTransactionHistory[i].defineSlug == "Spin") {
                            continue;
                        }

                        dataGame = {
                            playerName: gameTransactionHistory[i].playerName,
                            UserType: 'Apk',
                            defineSlug: gameTransactionHistory[i].defineSlug,
                            winningPattern: gameTransactionHistory[i].patternName,
                            totalWinning: eval(parseFloat(gameTransactionHistory[i].winningPrice).toFixed(2)),
                        }
                        gameData.push(dataGame);
                    }
                }
            }

            if (req.params.gameName == "Game2" || req.params.gameName == "Game3" || req.params.gameName == "Game4"){
                function limit(c) {
                    return this.filter((x, i) => {
                        if (i <= (c - 1)) { return true }
                    })
                }
    
                Array.prototype.limit = limit;
    
                function skip(c) {
                    return this.filter((x, i) => {
                        if (i > (c - 1)) { return true }
                    })
                }
    
                Array.prototype.skip = skip;
    
                function compareValues(key, order = 'asc') {
                    return function innerSort(a, b) {
                        if (!a.hasOwnProperty(key) || !b.hasOwnProperty(key)) {
                            // property doesn't exist on either object
                            return 0;
                        }
    
                        const varA = (typeof a[key] === 'string') ?
                            a[key].toUpperCase() : a[key];
                        const varB = (typeof b[key] === 'string') ?
                            b[key].toUpperCase() : b[key];
    
                        let comparison = 0;
                        if (varA > varB) {
                            comparison = 1;
                        } else if (varA < varB) {
                            comparison = -1;
                        }
                        return (
                            (order === 'desc') ? (comparison * -1) : comparison
                        );
                    };
                }
    
                console.log("sort", sort);
    
                let keyData = Object.keys(sort);
                let valueData = Object.values(sort);
                console.log("keyData", keyData[0]);
                console.log("valueData", valueData[0]);
    
    
                if (valueData[0] == 1) {
                    gameData.sort(compareValues(keyData));
                } else if (valueData[0] == -1) {
                    gameData.sort(compareValues(keyData, 'desc'));
                }
    
    
                let filtered = gameData.skip(start).limit(length);
    
    
                if (req.params.gameName == "Game1") {
                    if (filtered[0].length === 0) {
                        filtered = [];
                    }
                }
    
                let obj = {
                    'draw': req.query.draw,
                    'recordsTotal': (req.params.gameName == "Game4") ? gameData.length : (filtered.length > 0) ? filtered.length : 0,
                    'recordsFiltered': (req.params.gameName == "Game4") ? gameData.length : (filtered.length > 0) ? filtered.length : 0,
                    'data': filtered,
                };
                res.send(obj);
            }else{
                let obj = {
                    'draw': req.query.draw,
                    'recordsTotal': ticketsCount,
                    'recordsFiltered': ticketsCount,
                    'data': gameData,
                };
                res.send(obj);
            }
            

            

        } catch (e) {
            console.log("Error", e);
        }
    },

    viewTicket: async function(req, res) {
        try {

            let query = {
                _id: req.params.id
            };

            let gameData = await Sys.App.Services.GameService.getById(query);
            var gamePurchasedTicket = gameData.purchasedTickets;
            var gameWinners = gameData.winners;
            var patternHistoryWinner = gameData.patternWinnerHistory;
            var winningType = patternHistoryWinner.filter(obj => JSON.stringify(obj.ticketId) == JSON.stringify(req.params.ticketId));
            var winner = (winningType.length > 0) ? winningType[0].patternName : (gameWinners.filter(obj => JSON.stringify(obj.ticketId) == JSON.stringify(req.params.ticketId)).length > 0) ? "Full House" : "--";
            var ticketCellNumber = (gamePurchasedTicket.filter(obj => JSON.stringify(obj.ticketId) == JSON.stringify(req.params.ticketId)));


            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameMenu: 'active',
                Game: gameData,
                ticketCellNumber: (ticketCellNumber[0].ticketCellNumberList != undefined) ? ticketCellNumber[0].ticketCellNumberList : [],
                winner: (winner != undefined) ? winner : [],
                titleTicketHead: (ticketCellNumber[0].ticketNumber != undefined) ? ticketCellNumber[0].ticketNumber : [],
            };
            return res.render('GameManagement/ticketView', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    // [ Saved Game ]
    savedGameList: async function(req, res) {
        try {
            var gameType = await Sys.App.Services.GameService.getByDataSortGameType({});

            var gameData = [];
            var dataGame = {};
            for (var i = 0; i < gameType.length; i++) {
                dataGame = {
                    _id: gameType[i]._id,
                    name: gameType[i].name,
                }
                gameData.push(dataGame);
            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                savedGameList: 'active',
                DataOfGames: gameData,
            };
            return res.render('savedGame/list', data);


        } catch (error) {
            Sys.Log.error('Error in savedGameList: ', error);
            return new Error(error);
        }
    },

    savedGameDetailList: async function(req, res) {
        try {
            var gameType;
            //console.log("Req.params calling", req.params);

            if (req.params.id === null) {
                return res.send({ 'status': 'fail', message: 'Fail because option is not selected..' });
            } else {
                gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });
            }

            let Game;
            if (gameType.type == 'game_4') {
                Game = await Sys.App.Services.GameService.getSelectedSavedGameCount({ gameType: 'game_4' });
            } else {
                Game = 0;
            }

            var theadField = [
                'Sr No',
                'Game Name',
                'Action'
            ];

            var data = {
                gameData: gameType,
                theadField: theadField,
                Game: Game
            };
            res.send(data);

        } catch (error) {
            Sys.Log.error('Error in savedGameDetailList: ', error);
            return new Error(error);
        }
    },

    getSavedGameDetailList: async function(req, res) {
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
            var gameName;

            if (req.query.gameType == "game_1") {
                gameName = "Game1";
            } else if (req.query.gameType == "game_2") {
                gameName = "Game2";
            } else if (req.query.gameType == "game_3") {
                gameName = "Game3";
            } else if (req.query.gameType == "game_4") {
                gameName = "Game4";
            }

            let query = { gameName: gameName, status: "active" };
            if (search != '') {
                query = { gameNumber: { $regex: '.*' + search + '.*' }, gameName: gameName, status: "active" };
            }

            let reqCount = await Sys.App.Services.GameService.getSelectedSavedGameCount(query);

            let data = await Sys.App.Services.GameService.getSavedGame(query, length, start);

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            res.send(obj);
        } catch (error) {
            Sys.Log.error('Error in getSavedGameDetailList: ', error);
            return new Error(error);
        }
    },

    addSavedGameManagement: async function(req, res) {
        try {
            //console.log("addGamePostData params", req.params.typeId, req.params.type);
            console.log("addSavedGameManagement: ", req.body);
            console.log("req.params: ", req.params);

            var ID = Date.now()
            var createID = dateTimeFunction(ID);

            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                let seconds = dt.getSeconds();
                let miliSeconds = dt.getMilliseconds();
                let ampm = hours >= 12 ? 'pm' : 'am';
                hours = hours % 12;
                hours = hours ? hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                seconds = seconds < 10 ? '0' + seconds : seconds;
                let dateTime = year + '' + month + '' + date + '_' + hours + '' + minutes + seconds + miliSeconds;
                return dateTime; // Function returns the dateandtime
            }


            var game;

            if (req.params.type == "game_1") {
                let storeGamesData = [];
                let trafficLightOption = [];

                // For Single Game
                if (typeof(req.body.gameNameSelect) === 'string') {

                    let optionSelect = req.body.gameNameSelect;
                    let fields = optionSelect.split('|');

                    let arrTicketColorType = [];
                    let arrSameColorType = [];
                    let subGameId = fields[0];
                    let subGameName = fields[1];
                    let subGameType = fields[2];

                    let smallWhiteColor = (Array.isArray(req.body[[subGameType] + '_smallWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallWhite'][0]) : 0;
                    let largeWhiteColor = (Array.isArray(req.body[[subGameType] + '_largeWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeWhite'][0]) : 0;
                    let smallYellowColor = (Array.isArray(req.body[[subGameType] + '_smallYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallYellow'][0]) : 0;
                    let largeYellowColor = (Array.isArray(req.body[[subGameType] + '_largeYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeYellow'][0]) : 0;
                    let smallPurpleColor = (Array.isArray(req.body[[subGameType] + '_smallPurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallPurple'][0]) : 0;
                    let largePurpleColor = (Array.isArray(req.body[[subGameType] + '_largePurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largePurple'][0]) : 0;
                    let smallBlueColor = (Array.isArray(req.body[[subGameType] + '_smallBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallBlue'][0]) : 0;
                    let largeBlueColor = (Array.isArray(req.body[[subGameType] + '_largeBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeBlue'][0]) : 0;
                    let elvis1 = (Array.isArray(req.body[[subGameType] + '_elvis1'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis1'][0]) : 0;
                    let elvis2 = (Array.isArray(req.body[[subGameType] + '_elvis2'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis2'][0]) : 0;
                    let elvis3 = (Array.isArray(req.body[[subGameType] + '_elvis3'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis3'][0]) : 0;
                    let elvis4 = (Array.isArray(req.body[[subGameType] + '_elvis4'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis4'][0]) : 0;
                    let elvis5 = (Array.isArray(req.body[[subGameType] + '_elvis5'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis5'][0]) : 0;
                    let red = (Array.isArray(req.body[[subGameType] + '_red'])) ? arrTicketColorType.push(req.body[[subGameType] + '_red'][0]) : 0;
                    let yellow = (Array.isArray(req.body[[subGameType] + '_yellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_yellow'][0]) : 0;
                    let green = (Array.isArray(req.body[[subGameType] + '_green'])) ? arrTicketColorType.push(req.body[[subGameType] + '_green'][0]) : 0;

                    let same2ColorRY = (req.body[[subGameType] + '_twoSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                    let same2ColorRG = (req.body[[subGameType] + '_twoSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;
                    let same2ColorYR = (req.body[[subGameType] + '_twoSameRow_Yellow_Red'] == 'true') ? arrSameColorType.push('Yellow_Red') : 0;
                    let same2ColorYG = (req.body[[subGameType] + '_twoSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                    let same2ColorGR = (req.body[[subGameType] + '_twoSameRow_Green_Red'] == 'true') ? arrSameColorType.push('Green_Red') : 0;
                    let same2ColorGY = (req.body[[subGameType] + '_twoSameRow_Green_Yellow'] == 'true') ? arrSameColorType.push('Green_Yellow') : 0;

                    let same3ColorRY = (req.body[[subGameType] + '_threeSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                    let same3ColorYG = (req.body[[subGameType] + '_threeSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                    let same3ColorRG = (req.body[[subGameType] + '_threeSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;


                    let optionCreate = [];
                    let ticketColorTypesNo = [];

                    for (let i = 0; i < arrTicketColorType.length; i++) {
                        console.log("arrTicketColorType[i]", arrTicketColorType[i]);
                        let ticketCount = 0;
                        let ticketPrice = 0;

                        if (arrTicketColorType[i] == "Small White") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallWhite'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallWhiteColor']);
                        } else if (arrTicketColorType[i] == "Large White") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeWhite'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeWhiteColor']);
                        } else if (arrTicketColorType[i] == "Small Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallYellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallYellowColor']);
                        } else if (arrTicketColorType[i] == "Large Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeYellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeYellowColor']);
                        } else if (arrTicketColorType[i] == "Small Purple") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallPurple'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallPurpleColor']);
                        } else if (arrTicketColorType[i] == "Large Purple") {
                            ticketPrice = Number(req.body[[subGameType] + '_largePurple'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largePurpleColor']);
                        } else if (arrTicketColorType[i] == "Small Blue") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallBlue'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallBlueColor']);
                        } else if (arrTicketColorType[i] == "Large Blue") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeBlue'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeBlueColor']);
                        } else if (arrTicketColorType[i] == "Elvis 1") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis1'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis1Color']);
                        } else if (arrTicketColorType[i] == "Elvis 2") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis2'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis2Color']);
                        } else if (arrTicketColorType[i] == "Elvis 3") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis3'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis3Color']);
                        } else if (arrTicketColorType[i] == "Elvis 4") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis4'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis4Color']);
                        } else if (arrTicketColorType[i] == "Elvis 5") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis5'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis5Color']);
                        } else if (arrTicketColorType[i] == "Red") {
                            ticketPrice = Number(req.body[[subGameType] + '_red'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_redColor']);
                        } else if (arrTicketColorType[i] == "Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_yellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_yellowColor']);
                        } else if (arrTicketColorType[i] == "Green") {
                            ticketPrice = Number(req.body[[subGameType] + '_green'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_greenColor']);
                        }

                        let eightColorFlg = false;
                        var indx = ETICKETCOLORS.findIndex(row => row == arrTicketColorType[i]);
                        if (indx >= 0) {
                            eightColorFlg = true;
                        }

                        let saveObj = {}

                        let ColorName = (arrTicketColorType[i] == "Small White") ? "smallWhite" : (arrTicketColorType[i] == "Large White") ? "largeWhite" : (arrTicketColorType[i] == "Small Yellow") ? "smallYellow" : (arrTicketColorType[i] == "Large Yellow") ? "largeYellow" : (arrTicketColorType[i] == "Small Purple") ? "smallPurple" : (arrTicketColorType[i] == "Large Purple") ? "largePurple" : (arrTicketColorType[i] == "Small Blue") ? "smallBlue" : (arrTicketColorType[i] == "Large Blue") ? "largeBlue" : (arrTicketColorType[i] == "Elvis 1") ? "elvis1" : (arrTicketColorType[i] == "Elvis 2") ? "elvis2" : (arrTicketColorType[i] == "Elvis 3") ? "elvis3" : (arrTicketColorType[i] == "Elvis 4") ? "elvis4" : (arrTicketColorType[i] == "Elvis 5") ? "elvis5" : (arrTicketColorType[i] == "Red") ? "red" : (arrTicketColorType[i] == "Yellow") ? "yellow" : (arrTicketColorType[i] == "Green") ? "green" : "";
                        ticketColorTypesNo.push({
                            ticketName: arrTicketColorType[i],
                            ticketType: ColorName,
                            ticketPrice: ticketPrice,
                            ticketCount: ticketCount
                        });
                        //saveObj[ColorName] 
                        saveObj = {
                            ticketName: arrTicketColorType[i],
                            ticketType: ColorName,
                            ticketPrice: ticketPrice,
                            ticketCount: ticketCount,
                            totalPurchasedTickets: 0,
                            isEightColors: eightColorFlg,
                            jackpot: {
                                price: Number(req.body['jackpotPrice' + [subGameType]]),
                                draw: Number(req.body['jackpotDraws' + [subGameType]])
                            },
                        }

                        let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                        //let winning = {};
                        let winning = [];
                        let tmpBody = req.body;
                        let rowPattern = subGameRowData.patternRow;

                        for (let j = 0; j < rowPattern.length; j++) {

                            let tmpObj = {
                                winningPatternName: rowPattern[j].name,
                                winningPatternType: rowPattern[j].patType,
                                pattern: rowPattern[j].patternType,
                                isWoF: rowPattern[j].isWoF,
                                isTchest: rowPattern[j].isTchest,
                                isMys: rowPattern[j].isMys,
                                extraPercent: rowPattern[j].rowPercentage,
                                status: rowPattern[j].status,
                                isJackpot: rowPattern[j].isJackpot
                            }

                            if (arrTicketColorType[i] == "Small White" || arrTicketColorType[i] == "Large White" || arrTicketColorType[i] == "Small Yellow" || arrTicketColorType[i] == "Large Yellow" || arrTicketColorType[i] == "Small Purple" || arrTicketColorType[i] == "Large Purple" || arrTicketColorType[i] == "Small Blue" || arrTicketColorType[i] == "Large Blue") {
                                if (([subGameType] + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + [rowPattern[j].patType]] != '') { // This check this key in req.body if yes process other wise skip

                                    let extraWinnings = {}
                                    if (tmpObj.isMys == true) {
                                        extraWinnings = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                        }
                                    }
                                    let tChest = {};
                                    if (tmpObj.isTchest == true) {
                                        tChest = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                            prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                            prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                            prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                            prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                            prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                            prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                            prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                        }
                                    }

                                    tmpObj.extraWinningsTchest = tChest;
                                    //tmpObj[rowPattern[j].patType] = Number(tmpBody[[subGameType] + [rowPattern[j].patType]])
                                    tmpObj.winningValue = Number(tmpBody[[subGameType] + [rowPattern[j].patType]]);
                                    tmpObj.extraWinnings = extraWinnings;
                                    //winning[rowPattern[j].patType] = tmpObj;
                                    winning.push(tmpObj);

                                }

                            } else if (arrTicketColorType[i] == "Elvis 1" || arrTicketColorType[i] == "Elvis 2" || arrTicketColorType[i] == "Elvis 3" || arrTicketColorType[i] == "Elvis 4" || arrTicketColorType[i] == "Elvis 5" || arrTicketColorType[i] == "Red" || arrTicketColorType[i] == "Yellow" || arrTicketColorType[i] == "Green") {
                                if (([subGameType] + '_' + ColorName + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + '_' + ColorName + [rowPattern[j].patType]] != '') {

                                    let extraWinnings = {};
                                    if (tmpObj.isMys == true) {
                                        extraWinnings = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                        }
                                    }
                                    let tChest = {};
                                    if (tmpObj.isTchest == true) {
                                        tChest = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                            prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                            prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                            prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                            prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                            prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                            prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                            prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                        }
                                    }

                                    tmpObj.extraWinningsTchest = tChest;
                                    //tmpObj[rowPattern[j].patType] = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]])
                                    tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);
                                    tmpObj.extraWinnings = extraWinnings;
                                    //winning[rowPattern[j].patType] = tmpObj;
                                    winning.push(tmpObj);
                                }
                            }
                        }

                        //saveObj[ColorName].winning = winning;
                        saveObj.winning = winning;
                        optionCreate.push(saveObj);
                    }

                    let obj = {
                        //[subGameType]: {
                        subGameId: subGameId,
                        gameName: subGameName,
                        gameType: subGameType,
                        ticketColorTypes: arrTicketColorType,
                        ticketColorTypesNo: ticketColorTypesNo,
                        jackpotValues: {
                            price: Number(req.body['jackpotPrice' + [subGameType]]),
                            draw: Number(req.body['jackpotDraws' + [subGameType]])
                        },
                        options: optionCreate
                            //}
                    }
                    storeGamesData.push(obj);

                    // Same Color save
                    let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });

                    for (let k = 0; k < arrSameColorType.length; k++) {
                        let saveObj = {};
                        // let winning = {};
                        let winning = [];
                        let tmpBody = req.body;
                        let rowPattern = subGameRowData.patternRow;

                        let strLtd = arrSameColorType[k];
                        let splitColor = strLtd.split('_');
                        let nameColor1 = splitColor[0];
                        let nameColor2 = splitColor[1];

                        for (let j = 0; j < rowPattern.length; j++) {

                            let tmpObj = {
                                pattern: rowPattern[j].patternType,
                                isWoF: rowPattern[j].isWoF,
                                isTchest: rowPattern[j].isTchest,
                                isMys: rowPattern[j].isMys,
                                extraPercent: rowPattern[j].rowPercentage,
                                status: rowPattern[j].status,
                                isJackpot: rowPattern[j].isJackpot
                            }

                            let extraWinnings = {};
                            if (tmpObj.isMys == true) {
                                extraWinnings = {
                                    prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                    prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                    prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                    prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                    prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                }
                            }

                            tmpObj[rowPattern[j].patType] = {
                                [nameColor1.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor1 + '_' + [rowPattern[j].patType]]),
                                [nameColor2.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor2 + '_' + [rowPattern[j].patType]]),
                            }

                            tmpObj.rowKey = rowPattern[j].patType;
                            tmpObj.rowName = rowPattern[j].name;

                            let tChest = {};
                            if (tmpObj.isTchest == true) {
                                tChest = {
                                    prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                    prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                    prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                    prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                    prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                    prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                    prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                    prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                    prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                    prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                    prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                    prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                }
                            }

                            tmpObj.extraWinningsTchest = tChest;
                            tmpObj.extraWinnings = extraWinnings;
                            //winning[rowPattern[j].patType] = tmpObj;

                            winning.push(tmpObj);

                        }

                        saveObj = {
                            subGameId: subGameId,
                            gameName: subGameName,
                            gameType: subGameType,
                            type: subGameType + "_" + arrSameColorType[k],
                            winning: winning
                        }

                        trafficLightOption.push(saveObj);
                    }

                } else { // For Multiple Game
                    for (let r = 0; r < req.body.gameNameSelect.length; r++) {

                        let optionSelect = req.body.gameNameSelect[r];
                        let fields = optionSelect.split('|');
                        let arrSameColorType = [];
                        let arrTicketColorType = [];
                        let subGameId = fields[0];
                        let subGameName = fields[1];
                        let subGameType = fields[2];


                        let smallWhiteColor = (Array.isArray(req.body[[subGameType] + '_smallWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallWhite'][0]) : 0;
                        let largeWhiteColor = (Array.isArray(req.body[[subGameType] + '_largeWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeWhite'][0]) : 0;
                        let smallYellowColor = (Array.isArray(req.body[[subGameType] + '_smallYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallYellow'][0]) : 0;
                        let largeYellowColor = (Array.isArray(req.body[[subGameType] + '_largeYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeYellow'][0]) : 0;
                        let smallPurpleColor = (Array.isArray(req.body[[subGameType] + '_smallPurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallPurple'][0]) : 0;
                        let largePurpleColor = (Array.isArray(req.body[[subGameType] + '_largePurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largePurple'][0]) : 0;
                        let smallBlueColor = (Array.isArray(req.body[[subGameType] + '_smallBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallBlue'][0]) : 0;
                        let largeBlueColor = (Array.isArray(req.body[[subGameType] + '_largeBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeBlue'][0]) : 0;
                        let elvis1 = (Array.isArray(req.body[[subGameType] + '_elvis1'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis1'][0]) : 0;
                        let elvis2 = (Array.isArray(req.body[[subGameType] + '_elvis2'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis2'][0]) : 0;
                        let elvis3 = (Array.isArray(req.body[[subGameType] + '_elvis3'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis3'][0]) : 0;
                        let elvis4 = (Array.isArray(req.body[[subGameType] + '_elvis4'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis4'][0]) : 0;
                        let elvis5 = (Array.isArray(req.body[[subGameType] + '_elvis5'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis5'][0]) : 0;
                        let red = (Array.isArray(req.body[[subGameType] + '_red'])) ? arrTicketColorType.push(req.body[[subGameType] + '_red'][0]) : 0;
                        let yellow = (Array.isArray(req.body[[subGameType] + '_yellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_yellow'][0]) : 0;
                        let green = (Array.isArray(req.body[[subGameType] + '_green'])) ? arrTicketColorType.push(req.body[[subGameType] + '_green'][0]) : 0;


                        let same2ColorRY = (req.body[[subGameType] + '_twoSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                        let same2ColorRG = (req.body[[subGameType] + '_twoSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;
                        let same2ColorYR = (req.body[[subGameType] + '_twoSameRow_Yellow_Red'] == 'true') ? arrSameColorType.push('Yellow_Red') : 0;
                        let same2ColorYG = (req.body[[subGameType] + '_twoSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                        let same2ColorGR = (req.body[[subGameType] + '_twoSameRow_Green_Red'] == 'true') ? arrSameColorType.push('Green_Red') : 0;
                        let same2ColorGY = (req.body[[subGameType] + '_twoSameRow_Green_Yellow'] == 'true') ? arrSameColorType.push('Green_Yellow') : 0;

                        let same3ColorRY = (req.body[[subGameType] + '_threeSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                        let same3ColorYG = (req.body[[subGameType] + '_threeSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                        let same3ColorRG = (req.body[[subGameType] + '_threeSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;

                        let optionCreate = [];
                        let ticketColorTypesNo = [];

                        for (let i = 0; i < arrTicketColorType.length; i++) {

                            let ticketCount = 0;
                            let ticketPrice = 0;

                            if (arrTicketColorType[i] == "Small White") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallWhite'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallWhiteColor']);
                            } else if (arrTicketColorType[i] == "Large White") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeWhite'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeWhiteColor']);
                            } else if (arrTicketColorType[i] == "Small Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallYellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallYellowColor']);
                            } else if (arrTicketColorType[i] == "Large Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeYellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeYellowColor']);
                            } else if (arrTicketColorType[i] == "Small Purple") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallPurple'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallPurpleColor']);
                            } else if (arrTicketColorType[i] == "Large Purple") {
                                ticketPrice = Number(req.body[[subGameType] + '_largePurple'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largePurpleColor']);
                            } else if (arrTicketColorType[i] == "Small Blue") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallBlue'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallBlueColor']);
                            } else if (arrTicketColorType[i] == "Large Blue") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeBlue'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeBlueColor']);
                            } else if (arrTicketColorType[i] == "Elvis 1") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis1'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis1Color']);
                            } else if (arrTicketColorType[i] == "Elvis 2") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis2'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis2Color']);
                            } else if (arrTicketColorType[i] == "Elvis 3") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis3'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis3Color']);
                            } else if (arrTicketColorType[i] == "Elvis 4") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis4'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis4Color']);
                            } else if (arrTicketColorType[i] == "Elvis 5") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis5'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis5Color']);
                            } else if (arrTicketColorType[i] == "Red") {
                                ticketPrice = Number(req.body[[subGameType] + '_red'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_redColor']);
                            } else if (arrTicketColorType[i] == "Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_yellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_yellowColor']);
                            } else if (arrTicketColorType[i] == "Green") {
                                ticketPrice = Number(req.body[[subGameType] + '_green'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_greenColor']);
                            }

                            let eightColorFlg = false;
                            var indx = ETICKETCOLORS.findIndex(row => row == arrTicketColorType[i]);
                            if (indx >= 0) {
                                eightColorFlg = true;
                            }

                            let saveObj = {}

                            let ColorName = (arrTicketColorType[i] == "Small White") ? "smallWhite" : (arrTicketColorType[i] == "Large White") ? "largeWhite" : (arrTicketColorType[i] == "Small Yellow") ? "smallYellow" : (arrTicketColorType[i] == "Large Yellow") ? "largeYellow" : (arrTicketColorType[i] == "Small Purple") ? "smallPurple" : (arrTicketColorType[i] == "Large Purple") ? "largePurple" : (arrTicketColorType[i] == "Small Blue") ? "smallBlue" : (arrTicketColorType[i] == "Large Blue") ? "largeBlue" : (arrTicketColorType[i] == "Elvis 1") ? "elvis1" : (arrTicketColorType[i] == "Elvis 2") ? "elvis2" : (arrTicketColorType[i] == "Elvis 3") ? "elvis3" : (arrTicketColorType[i] == "Elvis 4") ? "elvis4" : (arrTicketColorType[i] == "Elvis 5") ? "elvis5" : (arrTicketColorType[i] == "Red") ? "red" : (arrTicketColorType[i] == "Yellow") ? "yellow" : (arrTicketColorType[i] == "Green") ? "green" : "";

                            //saveObj[ColorName] 
                            ticketColorTypesNo.push({
                                ticketName: arrTicketColorType[i],
                                ticketType: ColorName,
                                ticketPrice: ticketPrice,
                                ticketCount: ticketCount
                            });


                            saveObj = {
                                ticketName: arrTicketColorType[i],
                                ticketType: ColorName,
                                ticketPrice: ticketPrice,
                                ticketCount: ticketCount,
                                totalPurchasedTickets: 0,
                                isEightColors: eightColorFlg,
                                jackpot: {
                                    price: Number(req.body['jackpotPrice' + [subGameType]]),
                                    draw: Number(req.body['jackpotDraws' + [subGameType]])
                                },
                            }

                            let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                            //let winning = {};
                            let winning = [];
                            let tmpBody = req.body;
                            let rowPattern = subGameRowData.patternRow;
                            for (let j = 0; j < rowPattern.length; j++) {

                                let tmpObj = {
                                    winningPatternName: rowPattern[j].name,
                                    winningPatternType: rowPattern[j].patType,
                                    pattern: rowPattern[j].patternType,
                                    isWoF: rowPattern[j].isWoF,
                                    isTchest: rowPattern[j].isTchest,
                                    isMys: rowPattern[j].isMys,
                                    extraPercent: rowPattern[j].rowPercentage,
                                    status: rowPattern[j].status,
                                    isJackpot: rowPattern[j].isJackpot
                                }

                                if (arrTicketColorType[i] == "Small White" || arrTicketColorType[i] == "Large White" || arrTicketColorType[i] == "Small Yellow" || arrTicketColorType[i] == "Large Yellow" || arrTicketColorType[i] == "Small Purple" || arrTicketColorType[i] == "Large Purple" || arrTicketColorType[i] == "Small Blue" || arrTicketColorType[i] == "Large Blue") {
                                    if (([subGameType] + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + [rowPattern[j].patType]] != '') { // This check this key in req.body if yes process other wise skip

                                        let extraWinnings = {}
                                        let tChest = {}

                                        if (tmpObj.isMys == true) {
                                            extraWinnings = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                            }
                                        }

                                        if (tmpObj.isTchest == true) {
                                            tChest = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                                prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                                prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                                prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                                prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                                prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                                prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                                prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                            }
                                        }

                                        tmpObj.extraWinningsTchest = tChest;
                                        //tmpObj[rowPattern[j].patType] = Number(tmpBody[[subGameType] + [rowPattern[j].patType]])
                                        tmpObj.winningValue = Number(tmpBody[[subGameType] + [rowPattern[j].patType]]);
                                        tmpObj.extraWinnings = extraWinnings;
                                        //winning[rowPattern[j].patType] = tmpObj;
                                        winning.push(tmpObj);

                                    }

                                } else if (arrTicketColorType[i] == "Elvis 1" || arrTicketColorType[i] == "Elvis 2" || arrTicketColorType[i] == "Elvis 3" || arrTicketColorType[i] == "Elvis 4" || arrTicketColorType[i] == "Elvis 5" || arrTicketColorType[i] == "Red" || arrTicketColorType[i] == "Yellow" || arrTicketColorType[i] == "Green") {
                                    if (([subGameType] + '_' + ColorName + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + '_' + ColorName + [rowPattern[j].patType]] != '') {
                                        let tChest = {}
                                        let extraWinnings = {};

                                        if (tmpObj.isMys == true) {
                                            extraWinnings = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                            }
                                        }

                                        if (tmpObj.isTchest == true) {
                                            tChest = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                                prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                                prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                                prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                                prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                                prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                                prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                                prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                            }
                                        }

                                        tmpObj.extraWinningsTchest = tChest;
                                        //tmpObj[rowPattern[j].patType] = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]])
                                        tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);
                                        tmpObj.extraWinnings = extraWinnings;
                                        //winning[rowPattern[j].patType] = tmpObj;
                                        winning.push(tmpObj);

                                    }
                                }
                            }
                            //saveObj[ColorName].winning = winning;
                            saveObj.winning = winning;
                            optionCreate.push(saveObj);
                        }

                        let obj = {
                            //[subGameType]: {
                            subGameId: subGameId,
                            gameName: subGameName,
                            gameType: subGameType,
                            ticketColorTypes: arrTicketColorType,
                            ticketColorTypesNo: ticketColorTypesNo,
                            jackpotValues: {
                                price: Number(req.body['jackpotPrice' + [subGameType]]),
                                draw: Number(req.body['jackpotDraws' + [subGameType]])
                            },
                            options: optionCreate
                                //}
                        }
                        storeGamesData.push(obj);


                        // Same Color save
                        let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                        for (let k = 0; k < arrSameColorType.length; k++) {
                            let saveObj = {};
                            //let winning = {};
                            let winning = [];
                            let tmpBody = req.body;
                            let rowPattern = subGameRowData.patternRow;

                            let strLtd = arrSameColorType[k];
                            let splitColor = strLtd.split('_');
                            let nameColor1 = splitColor[0];
                            let nameColor2 = splitColor[1];

                            for (let j = 0; j < rowPattern.length; j++) {

                                let tmpObj = {
                                    pattern: rowPattern[j].patternType,
                                    isWoF: rowPattern[j].isWoF,
                                    isTchest: rowPattern[j].isTchest,
                                    isMys: rowPattern[j].isMys,
                                    extraPercent: rowPattern[j].rowPercentage,
                                    status: rowPattern[j].status,
                                    isJackpot: rowPattern[j].isJackpot
                                }

                                tmpObj.rowKey = rowPattern[j].patType;
                                tmpObj.rowName = rowPattern[j].name;

                                let extraWinnings = {};
                                if (tmpObj.isMys == true) {
                                    extraWinnings = {
                                        prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                        prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                        prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                        prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                        prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                    }
                                }

                                tmpObj[rowPattern[j].patType] = {
                                    [nameColor1.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor1 + '_' + [rowPattern[j].patType]]),
                                    [nameColor2.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor2 + '_' + [rowPattern[j].patType]]),
                                }

                                let tChest = {};
                                if (tmpObj.isTchest == true) {
                                    tChest = {
                                        prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                        prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                        prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                        prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                        prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                        prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                        prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                        prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                        prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                        prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                        prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                        prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                    }
                                }

                                tmpObj.extraWinningsTchest = tChest;
                                tmpObj.extraWinnings = extraWinnings;
                                // winning[rowPattern[j].patType] = tmpObj;
                                winning.push(tmpObj);
                            }

                            saveObj = {
                                subGameId: subGameId,
                                gameName: subGameName,
                                gameType: subGameType,
                                type: subGameType + "_" + arrSameColorType[k],
                                winning: winning
                            }

                            trafficLightOption.push(saveObj);
                        }

                    }
                }


                let hallArray = [];
                let hall = req.body.hallSelecteds;
                let hallData, hallObj = {};
                let allHallTabaleId = [];

                if (typeof(hall) === 'string') {
                    console.log("hall", hall);
                    let hallId = await Sys.Helper.bingo.obId(hall);
                    hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                    if (!hallData) {
                        req.flash('error', 'Hall Not Found');
                        return res.redirect('/agent');
                    } else {
                        hallObj = {
                            _id: hallData._id,
                            name: hallData.name,
                            hallId: hallData.hallId,
                            status: hallData.status
                        }
                        hallArray.push(hallObj);
                        allHallTabaleId.push(hallData._id);
                    }
                } else {
                    for (let i = 0; i < hall.length; i++) {
                        let hallId = await Sys.Helper.bingo.obId(hall[i]);
                        hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                        if (!hallData) {
                            req.flash('error', 'Hall Not Found');
                            return res.redirect('/agent');
                        } else {
                            hallObj = {
                                _id: hallData._id,
                                name: hallData.name,
                                hallId: hallData.hallId,
                                status: hallData.status
                            }
                            hallArray.push(hallObj);
                            allHallTabaleId.push(hallData._id);
                        }
                    }
                }

                let masterObj = {};
                if (typeof(req.body.masterHallSelected) === 'string') {
                    let hallId = await Sys.Helper.bingo.obId(req.body.masterHallSelected);
                    hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                    if (!hallData) {
                        req.flash('error', 'Hall Not Found');
                        return res.redirect('/gameManagement');
                    } else {
                        masterObj = {
                            _id: hallData._id,
                            name: hallData.name,
                            hallId: hallData.hallId,
                            status: hallData.status
                        }
                    }
                }

                game = await Sys.App.Services.GameService.insertSavedGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game1',
                    gameNumber: createID + '_G1',
                    gameType: req.params.type,
                    status: "active",
                    day: req.body.day,
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    startDate: req.body.start_date,
                    graceDate: req.body.grace_time,
                    minTicketCount: req.body.minTicketCount,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    seconds: req.body.seconds * 1000,
                    trafficLightExtraOptions: trafficLightOption,
                    subGames: storeGamesData,
                    halls: hallArray,
                    allHallsId: allHallTabaleId,
                    masterHall: masterObj,
                    isMasterGame: true,
                    isSubGame: false
                });

            } else if (req.params.type == "game_2") {

                let query = { _id: req.params.typeId };
                let gameType = await Sys.App.Services.GameService.getGameTypeById(query);
                //console.log("gameType", gameType);


                game = await Sys.App.Services.GameService.insertSavedGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game2',
                    gameNumber: createID + '_G2',
                    gameType: req.params.type,
                    status: "active",
                    gameTypeId: req.params.typeId,
                    day: req.body.day,
                    createrId: req.session.details.id,
                    startDate: req.body.start_date,
                    graceDate: req.body.grace_time,
                    minTicketCount: req.body.minTicketCount,
                    totalNoTickets: req.body.totalNoTickets,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    ticketPrice: req.body.ticketPrice,
                    seconds: req.body.seconds * 1000,
                    jackPotNumber: {
                        9: req.body.priceNine,
                        10: req.body.priceTen,
                        11: req.body.priceEleven,
                        12: req.body.priceTwelve,
                        13: req.body.priceThirteen,
                        1421: req.body.priceFourteenToTwentyone,
                    }
                });

            } else if (req.params.type == "game_3") {

                var prtnAr = req.body.prtnAr;
                let shivshakti = [].concat.apply([], req.body.allPatternArray);

                var patternGroupNumberPrize = [];

                let query = { _id: req.params.typeId };
                let gameType = await Sys.App.Services.GameService.getGameTypeById(query);

                game = await Sys.App.Services.GameService.insertSavedGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game3',
                    gameNumber: createID + '_G3',
                    gameType: req.params.type,
                    status: "active",
                    columns: gameType.columns,
                    gameTypeId: req.params.typeId,
                    day: req.body.day,
                    createrId: req.session.details.id,
                    startDate: req.body.start_date,
                    graceDate: req.body.grace_time,
                    minTicketCount: req.body.minTicketCount,
                    totalNoTickets: req.body.totalNoTickets,
                    totalNoPurchasedTickets: req.body.totalNoTickets,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    ticketPrice: req.body.ticketPrice,
                    patternGroupNumberPrize: prtnAr,
                    allPatternArray: shivshakti,
                    seconds: req.body.seconds * 1000,
                });

                console.log('Game: ', game);

            } else if (req.params.type == "game_4") {

                // [ String To Number ]
                var newArrayBetAmount = req.body.betAmount.map(function(x) {
                    return parseInt(x, 10);
                });

                let n = 3; // [ Array Rows ]

                let arr1 = [];
                let arr2 = [];
                let arr3 = [];
                let arr4 = [];

                let cntt = 0;
                for (let i = 0; i < newArrayBetAmount.length; i++) {
                    let index = newArrayBetAmount.indexOf(newArrayBetAmount[i]);

                    if (cntt == n) {
                        arr1.push(newArrayBetAmount[i]);
                        cntt = 0;
                    } else if (cntt == (n - 1)) {
                        arr2.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    } else if (cntt == (n - 2)) {
                        arr3.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    } else {
                        arr4.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    }
                }

                let result = [
                    [...arr4],
                    [...arr3],
                    [...arr2],
                    [...arr1]
                ];

                let json = {};
                for (let i = 0; i < 4; i++) {
                    json['ticket' + (i + 1) + 'Multiplier'] = result[i];
                }

                game = await Sys.App.Services.GameService.insertGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game4',
                    gameNumber: createID + '_G4',
                    gameType: req.params.type,
                    status: "active",
                    gameTypeId: req.params.typeId,
                    day: req.body.day,
                    createrId: req.session.details.id,
                    totalNoTickets: 4,
                    betAmount: req.body.betAmount,
                    ticketPrice: req.body.ticketPrice,
                    betMultiplier: req.body.betMultiplier,
                    betData: json,
                    seconds2: req.body.seconds2 * 1000,
                    seconds: req.body.seconds * 1000,
                    patternNamePrice: {
                        'Pattern1': req.body.priceOne,
                        'Pattern2': req.body.priceTwo,
                        'Pattern3': req.body.priceThree,
                        'Pattern4': req.body.priceFour,
                        'Pattern5': req.body.priceFive,
                        'Pattern6': req.body.priceSix,
                        'Pattern7': req.body.priceSeven,
                        'Pattern8': req.body.priceEight,
                        'Pattern9': req.body.priceNine,
                        'Pattern10': req.body.priceTen,
                        'Pattern11': req.body.priceEleven,
                        'Pattern12': req.body.priceTwelve,
                        'Pattern13': req.body.priceThirteen,
                        'Pattern14': req.body.priceFourteen,
                        'Pattern15': req.body.priceFifteen
                    }
                });

            }

            if (!game) {
                res.send({ status: 'fail' });
            } else {
                res.send({ status: 'success' });
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    editSaveGameManagement: async function(req, res) {
        try {
            //console.log("editGame", req.params);

            let Game = await Sys.App.Services.GameService.getByIdSavedGames({ _id: req.params.id });
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });

            var startDateAt = (Game.startDate == null) ? '' : dateTimeFunction(Game.startDate);
            var graceDateAt = (Game.graceDate == null) ? '' : dateTimeFunction(Game.graceDate);

            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                minutes = minutes < 10 ? '0' + minutes : minutes;
                let dateTime = (year + '/' + month + '/' + date + ' ' + hours + ':' + minutes);
                return dateTime; // Function returns the dateandtime
            }

            let printDataPattern, arr = [],
                ptrn;
            if (Game.gameName == "Game4") {
                ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_4" });
                arr = ['Pattern1', 'Pattern2', 'Pattern3', 'Pattern4', 'Pattern5', 'Pattern6', 'Pattern7', 'Pattern8', 'Pattern9', 'Pattern10', 'Pattern11', 'Pattern12', 'Pattern13', 'Pattern14', 'Pattern15']
                printDataPattern = Game.patternNamePrice[0];
                for (let i = 0; i < ptrn.length; i++) {
                    ptrn[i].name = arr[i];
                    ptrn[i].price = printDataPattern['Pattern' + (i + 1)];
                }
            } else {
                ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_3" });
            }

            let gl = (Game.gameType == 'game_3') ? Game.patternGroupNumberPrize.length : 0;

            let hallArray;
            let agentHallArray;
            if (req.session.details.role == 'agent') {
                let agentId = await Sys.Helper.bingo.obId(req.session.details.id);
                agentHallArray = await Sys.App.Services.HallServices.getByData({ 'agents._id': agentId });
            } else {
                hallArray = await Sys.App.Services.HallServices.getByData();
            }

            let subGameList = await Sys.App.Services.subGame1Services.getAllDataSelect({ status: 'active' }, { ticketColor: 1, gameName: 1, subGameId: 1, gameType: 1, allPatternRowId: 1 });

            //console.log(" Game Game Game Game Game : ",Game)

            // [ Row and Color ]
            let subGameColorRow = {};
            let rows = [];
            for (let s = 0; s < subGameList.length; s++) {
                // console.log(" ++++++++++++++++++++++ : ",subGameList[s].ticketColor)
                for (let r = 0; r < subGameList[s].allPatternRowId.length; r++) {
                    rows.push(subGameList[s].allPatternRowId[r])
                }
            }
            let patternListing = await Sys.App.Services.patternServices.getGamePatternData({ _id: { $in: rows } }, { isTchest: 1, isMys: 1, patternName: 1, patType: 1, isJackpot: 1 });
            for (let s = 0; s < subGameList.length; s++) {
                let obj = {};
                obj.colors = subGameList[s].ticketColor;
                let rowsData = [];
                for (let r = 0; r < subGameList[s].allPatternRowId.length; r++) {
                    if (patternListing.length > 0) {
                        let index = patternListing.findIndex(e => e._id == subGameList[s].allPatternRowId[r].toString());
                        if (index !== -1) {
                            rowsData.push({ name: patternListing[index].patternName, type: patternListing[index].patType, isMys: patternListing[index].isMys, isTchest: patternListing[index].isTchest, isJackpot: patternListing[index].isJackpot })
                        }
                    }
                }
                obj.rows = rowsData;
                obj.gameName = subGameList[s].gameName;
                obj.subGameId = subGameList[s].subGameId;
                obj.gameType = subGameList[s].gameType;
                subGameColorRow[subGameList[s].gameType] = obj;
            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                savedGameList: 'active',
                Game: Game,
                GameJSON: JSON.stringify(Game),
                pattern: ptrn,
                patternData: ptrn,
                gL: gl,
                seconds: Game.seconds / 1000,
                seconds2: Game.seconds2 / 1000,
                StartDate: startDateAt,
                GraceTime: graceDateAt,
                gameData: gameType,
                agentHallArray: agentHallArray,
                hallArray: hallArray,
                subGameList: subGameList,
                subGameColorRow: JSON.stringify(subGameColorRow),
                gameSubGames: JSON.stringify(Game.subGames)
            };
            return res.render('savedGame/gameAdd', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    editSaveGameManagementPostData: async function(req, res) {
        try {

            //console.log("editSaveGameManagementPostData", req.params);
            console.log("editGamePoseditSaveGameManagementPostDatatData", req.body);
            let GameId = await Sys.App.Services.GameService.getByIdSavedGames({ _id: req.params.id });
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });
            let updateGame;
           
            console.log(" aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa : ",GameId)

            var ID = Date.now()
            var createID = dateTimeFunction(ID);

            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                let seconds = dt.getSeconds();
                let miliSeconds = dt.getMilliseconds();
                let ampm = hours >= 12 ? 'pm' : 'am';
                hours = hours % 12;
                hours = hours ? hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                seconds = seconds < 10 ? '0' + seconds : seconds;
                let dateTime = year + '' + month + '' + date + '_' + hours + '' + minutes + seconds + miliSeconds;
                return dateTime; // Function returns the dateandtime
            }


            if (gameType.type == "game_1") {

                let storeGamesData = [];
                let trafficLightOption = [];
                // For Single Game
                if (typeof(req.body.gameNameSelect) === 'string') {

                    // start 8 color of single inputs 
                    let optionSelect = req.body.gameNameSelect;
                    let fields = optionSelect.split('|');

                    let arrTicketColorType = [];
                    let arrSameColorType = [];
                    let subGameId = fields[0];
                    let subGameName = fields[1];
                    let subGameType = fields[2];

                    // console.log(" eightColorValues eightColorValues eightColorValues :",eightColorValues)

                    // console.log("eightColorInputRowsName eightColorInputRowsName aaaaaaaaaaaaaaa :",eightColorInputRowsName)
                    // console.log("eightColorInputValues eightColorInputValues bbbbbbbbbbbbbbb :",eightColorInputValues)

                    let smallWhiteColor = (Array.isArray(req.body[[subGameType] + '_smallWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallWhite'][0]) : 0;
                    let largeWhiteColor = (Array.isArray(req.body[[subGameType] + '_largeWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeWhite'][0]) : 0;
                    let smallYellowColor = (Array.isArray(req.body[[subGameType] + '_smallYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallYellow'][0]) : 0;
                    let largeYellowColor = (Array.isArray(req.body[[subGameType] + '_largeYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeYellow'][0]) : 0;
                    let smallPurpleColor = (Array.isArray(req.body[[subGameType] + '_smallPurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallPurple'][0]) : 0;
                    let largePurpleColor = (Array.isArray(req.body[[subGameType] + '_largePurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largePurple'][0]) : 0;
                    let smallBlueColor = (Array.isArray(req.body[[subGameType] + '_smallBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallBlue'][0]) : 0;
                    let largeBlueColor = (Array.isArray(req.body[[subGameType] + '_largeBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeBlue'][0]) : 0;
                    let elvis1 = (Array.isArray(req.body[[subGameType] + '_elvis1'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis1'][0]) : 0;
                    let elvis2 = (Array.isArray(req.body[[subGameType] + '_elvis2'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis2'][0]) : 0;
                    let elvis3 = (Array.isArray(req.body[[subGameType] + '_elvis3'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis3'][0]) : 0;
                    let elvis4 = (Array.isArray(req.body[[subGameType] + '_elvis4'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis4'][0]) : 0;
                    let elvis5 = (Array.isArray(req.body[[subGameType] + '_elvis5'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis5'][0]) : 0;
                    let red = (Array.isArray(req.body[[subGameType] + '_red'])) ? arrTicketColorType.push(req.body[[subGameType] + '_red'][0]) : 0;
                    let yellow = (Array.isArray(req.body[[subGameType] + '_yellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_yellow'][0]) : 0;
                    let green = (Array.isArray(req.body[[subGameType] + '_green'])) ? arrTicketColorType.push(req.body[[subGameType] + '_green'][0]) : 0;

                    let same2ColorRY = (req.body[[subGameType] + '_twoSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                    let same2ColorRG = (req.body[[subGameType] + '_twoSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;
                    let same2ColorYR = (req.body[[subGameType] + '_twoSameRow_Yellow_Red'] == 'true') ? arrSameColorType.push('Yellow_Red') : 0;
                    let same2ColorYG = (req.body[[subGameType] + '_twoSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                    let same2ColorGR = (req.body[[subGameType] + '_twoSameRow_Green_Red'] == 'true') ? arrSameColorType.push('Green_Red') : 0;
                    let same2ColorGY = (req.body[[subGameType] + '_twoSameRow_Green_Yellow'] == 'true') ? arrSameColorType.push('Green_Yellow') : 0;

                    let same3ColorRY = (req.body[[subGameType] + '_threeSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                    let same3ColorYG = (req.body[[subGameType] + '_threeSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                    let same3ColorRG = (req.body[[subGameType] + '_threeSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;


                    let optionCreate = [];
                    let ticketColorTypesNo = [];

                    for (let i = 0; i < arrTicketColorType.length; i++) {
                        console.log("arrTicketColorType[i]", arrTicketColorType[i]);



                        let ticketCount = 0;
                        let ticketPrice = 0;

                        if (arrTicketColorType[i] == "Small White") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallWhite'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallWhiteColor']);
                        } else if (arrTicketColorType[i] == "Large White") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeWhite'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeWhiteColor']);
                        } else if (arrTicketColorType[i] == "Small Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallYellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallYellowColor']);
                        } else if (arrTicketColorType[i] == "Large Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeYellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeYellowColor']);
                        } else if (arrTicketColorType[i] == "Small Purple") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallPurple'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallPurpleColor']);
                        } else if (arrTicketColorType[i] == "Large Purple") {
                            ticketPrice = Number(req.body[[subGameType] + '_largePurple'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largePurpleColor']);
                        } else if (arrTicketColorType[i] == "Small Blue") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallBlue'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallBlueColor']);
                        } else if (arrTicketColorType[i] == "Large Blue") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeBlue'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeBlueColor']);
                        } else if (arrTicketColorType[i] == "Elvis 1") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis1'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis1Color']);
                        } else if (arrTicketColorType[i] == "Elvis 2") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis2'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis2Color']);
                        } else if (arrTicketColorType[i] == "Elvis 3") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis3'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis3Color']);
                        } else if (arrTicketColorType[i] == "Elvis 4") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis4'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis4Color']);
                        } else if (arrTicketColorType[i] == "Elvis 5") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis5'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis5Color']);
                        } else if (arrTicketColorType[i] == "Red") {
                            ticketPrice = Number(req.body[[subGameType] + '_red'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_redColor']);
                        } else if (arrTicketColorType[i] == "Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_yellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_yellowColor']);
                        } else if (arrTicketColorType[i] == "Green") {
                            ticketPrice = Number(req.body[[subGameType] + '_green'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_greenColor']);
                        }


                        let eightColorFlg = false;
                        var indx = ETICKETCOLORS.findIndex(row => row == arrTicketColorType[i]);
                        if (indx >= 0) {
                            eightColorFlg = true;
                        }



                        let saveObj = {}

                        let ColorName = (arrTicketColorType[i] == "Small White") ? "smallWhite" : (arrTicketColorType[i] == "Large White") ? "largeWhite" : (arrTicketColorType[i] == "Small Yellow") ? "smallYellow" : (arrTicketColorType[i] == "Large Yellow") ? "largeYellow" : (arrTicketColorType[i] == "Small Purple") ? "smallPurple" : (arrTicketColorType[i] == "Large Purple") ? "largePurple" : (arrTicketColorType[i] == "Small Blue") ? "smallBlue" : (arrTicketColorType[i] == "Large Blue") ? "largeBlue" : (arrTicketColorType[i] == "Elvis 1") ? "elvis1" : (arrTicketColorType[i] == "Elvis 2") ? "elvis2" : (arrTicketColorType[i] == "Elvis 3") ? "elvis3" : (arrTicketColorType[i] == "Elvis 4") ? "elvis4" : (arrTicketColorType[i] == "Elvis 5") ? "elvis5" : (arrTicketColorType[i] == "Red") ? "red" : (arrTicketColorType[i] == "Yellow") ? "yellow" : (arrTicketColorType[i] == "Green") ? "green" : "";

                        ticketColorTypesNo.push({
                            ticketName: arrTicketColorType[i],
                            ticketType: ColorName,
                            ticketPrice: ticketPrice,
                            ticketCount: ticketCount
                        });


                        //saveObj[ColorName] 
                        saveObj = {
                            ticketName: arrTicketColorType[i],
                            ticketType: ColorName,
                            ticketPrice: ticketPrice,
                            ticketCount: ticketCount,
                            totalPurchasedTickets: 0,
                            isEightColors: eightColorFlg,
                            jackpot: {
                                price: Number(req.body['jackpotPrice' + [subGameType]]),
                                draw: Number(req.body['jackpotDraws' + [subGameType]])
                            },
                        }

                        let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                        //let winning = {};
                        let winning = [];
                        let tmpBody = req.body;
                        let rowPattern = subGameRowData.patternRow;

                        console.log(" subGameRowData subGameRowData :", subGameRowData)
                        console.log("  subGameId subGameId :" + subGameId)

                        for (let j = 0; j < rowPattern.length; j++) {

                            let tmpObj = {
                                winningPatternName: rowPattern[j].name,
                                winningPatternType: rowPattern[j].patType,
                                pattern: rowPattern[j].patternType,
                                isWoF: rowPattern[j].isWoF,
                                isTchest: rowPattern[j].isTchest,
                                isMys: rowPattern[j].isMys,
                                extraPercent: rowPattern[j].rowPercentage,
                                status: rowPattern[j].status,
                                isJackpot: rowPattern[j].isJackpot
                            }

                            console.log(" ([subGameType] + [rowPattern[j].patType] in req.body) :", req.body[[subGameType] + [rowPattern[j].patType]], " arrTicketColorType[i] arrTicketColorType[i] : ", arrTicketColorType[i])

                            console.log(" [subGameType] : ", [subGameType], " [rowPattern[j].patType] : ", [rowPattern[j].patType])

                            if (arrTicketColorType[i] == "Small White" || arrTicketColorType[i] == "Large White" || arrTicketColorType[i] == "Small Yellow" || arrTicketColorType[i] == "Large Yellow" || arrTicketColorType[i] == "Small Purple" || arrTicketColorType[i] == "Large Purple" || arrTicketColorType[i] == "Small Blue" || arrTicketColorType[i] == "Large Blue") {
                                if (([subGameType] + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + [rowPattern[j].patType]] != '') { // This check this key in req.body if yes process other wise skip

                                    let extraWinnings = {}
                                    if (tmpObj.isMys == true) {
                                        extraWinnings = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                        }
                                    }
                                    let tChest = {};
                                    if (tmpObj.isTchest == true) {
                                        tChest = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                            prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                            prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                            prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                            prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                            prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                            prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                            prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                        }
                                    }

                                    tmpObj.extraWinningsTchest = tChest;
                                    //tmpObj[rowPattern[j].patType] = Number(tmpBody[[subGameType] + [rowPattern[j].patType]])
                                    tmpObj.winningValue = Number(tmpBody[[subGameType] + [rowPattern[j].patType]]);
                                    tmpObj.extraWinnings = extraWinnings;
                                    //winning[rowPattern[j].patType] = tmpObj;
                                    winning.push(tmpObj);

                                }

                            } else if (arrTicketColorType[i] == "Elvis 1" || arrTicketColorType[i] == "Elvis 2" || arrTicketColorType[i] == "Elvis 3" || arrTicketColorType[i] == "Elvis 4" || arrTicketColorType[i] == "Elvis 5" || arrTicketColorType[i] == "Red" || arrTicketColorType[i] == "Yellow" || arrTicketColorType[i] == "Green") {
                                if (([subGameType] + '_' + ColorName + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + '_' + ColorName + [rowPattern[j].patType]] != '') {

                                    let extraWinnings = {};
                                    if (tmpObj.isMys == true) {
                                        extraWinnings = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                        }
                                    }
                                    let tChest = {};
                                    if (tmpObj.isTchest == true) {
                                        tChest = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                            prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                            prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                            prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                            prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                            prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                            prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                            prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                        }
                                    }

                                    tmpObj.extraWinningsTchest = tChest;
                                    //tmpObj[rowPattern[j].patType] = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]])
                                    tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);
                                    tmpObj.extraWinnings = extraWinnings;
                                    //winning[rowPattern[j].patType] = tmpObj;
                                    winning.push(tmpObj);
                                }
                            }
                        }

                        //saveObj[ColorName].winning = winning;
                        saveObj.winning = winning;
                        optionCreate.push(saveObj);

                    }

                    let obj = {
                        //[subGameType]: {
                        subGameId: subGameId,
                        gameName: subGameName,
                        gameType: subGameType,
                        ticketColorTypes: arrTicketColorType,
                        ticketColorTypesNo: ticketColorTypesNo,
                        jackpotValues: {
                            price: Number(req.body['jackpotPrice' + [subGameType]]),
                            draw: Number(req.body['jackpotDraws' + [subGameType]])
                        },
                        options: optionCreate,

                        //}
                    }
                    storeGamesData.push(obj);

                    // Same Color save
                    let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });

                    for (let k = 0; k < arrSameColorType.length; k++) {
                        console.log(" arrSameColorType arrSameColorType : : :")
                        let saveObj = {};
                        // let winning = {};
                        let winning = [];
                        let tmpBody = req.body;
                        let rowPattern = subGameRowData.patternRow;

                        let strLtd = arrSameColorType[k];
                        let splitColor = strLtd.split('_');
                        let nameColor1 = splitColor[0];
                        let nameColor2 = splitColor[1];

                        for (let j = 0; j < rowPattern.length; j++) {

                            let tmpObj = {
                                pattern: rowPattern[j].patternType,
                                isWoF: rowPattern[j].isWoF,
                                isTchest: rowPattern[j].isTchest,
                                isMys: rowPattern[j].isMys,
                                extraPercent: rowPattern[j].rowPercentage,
                                status: rowPattern[j].status,
                                isJackpot: rowPattern[j].isJackpot
                            }

                            let extraWinnings = {};
                            if (tmpObj.isMys == true) {
                                extraWinnings = {
                                    prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                    prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                    prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                    prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                    prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                }
                            }

                            tmpObj[rowPattern[j].patType] = {
                                [nameColor1.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor1 + '_' + [rowPattern[j].patType]]),
                                [nameColor2.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor2 + '_' + [rowPattern[j].patType]]),
                            }

                            let tChest = {};
                            if (tmpObj.isTchest == true) {
                                tChest = {
                                    prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                    prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                    prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                    prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                    prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                    prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                    prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                    prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                    prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                    prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                    prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                    prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                }
                            }

                            tmpObj.extraWinningsTchest = tChest;
                            tmpObj.extraWinnings = extraWinnings;
                            //winning[rowPattern[j].patType] = tmpObj;

                            winning.push(tmpObj);

                        }

                        saveObj = {
                            subGameId: subGameId,
                            gameName: subGameName,
                            gameType: subGameType,
                            type: subGameType + "_" + arrSameColorType[k],
                            gameColorsCmbName: subGameType+" "+nameColor1+" & "+nameColor2, 
                            winning: winning
                        }

                        trafficLightOption.push(saveObj);
                    }

                } else { // For Multiple Game
                    for (let r = 0; r < req.body.gameNameSelect.length; r++) {

                        let optionSelect = req.body.gameNameSelect[r];
                        let fields = optionSelect.split('|');
                        let arrSameColorType = [];
                        let arrTicketColorType = [];
                        let subGameId = fields[0];
                        let subGameName = fields[1];
                        let subGameType = fields[2];


                        let smallWhiteColor = (Array.isArray(req.body[[subGameType] + '_smallWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallWhite'][0]) : 0;
                        let largeWhiteColor = (Array.isArray(req.body[[subGameType] + '_largeWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeWhite'][0]) : 0;
                        let smallYellowColor = (Array.isArray(req.body[[subGameType] + '_smallYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallYellow'][0]) : 0;
                        let largeYellowColor = (Array.isArray(req.body[[subGameType] + '_largeYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeYellow'][0]) : 0;
                        let smallPurpleColor = (Array.isArray(req.body[[subGameType] + '_smallPurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallPurple'][0]) : 0;
                        let largePurpleColor = (Array.isArray(req.body[[subGameType] + '_largePurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largePurple'][0]) : 0;
                        let smallBlueColor = (Array.isArray(req.body[[subGameType] + '_smallBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallBlue'][0]) : 0;
                        let largeBlueColor = (Array.isArray(req.body[[subGameType] + '_largeBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeBlue'][0]) : 0;
                        let elvis1 = (Array.isArray(req.body[[subGameType] + '_elvis1'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis1'][0]) : 0;
                        let elvis2 = (Array.isArray(req.body[[subGameType] + '_elvis2'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis2'][0]) : 0;
                        let elvis3 = (Array.isArray(req.body[[subGameType] + '_elvis3'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis3'][0]) : 0;
                        let elvis4 = (Array.isArray(req.body[[subGameType] + '_elvis4'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis4'][0]) : 0;
                        let elvis5 = (Array.isArray(req.body[[subGameType] + '_elvis5'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis5'][0]) : 0;
                        let red = (Array.isArray(req.body[[subGameType] + '_red'])) ? arrTicketColorType.push(req.body[[subGameType] + '_red'][0]) : 0;
                        let yellow = (Array.isArray(req.body[[subGameType] + '_yellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_yellow'][0]) : 0;
                        let green = (Array.isArray(req.body[[subGameType] + '_green'])) ? arrTicketColorType.push(req.body[[subGameType] + '_green'][0]) : 0;


                        let same2ColorRY = (req.body[[subGameType] + '_twoSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                        let same2ColorRG = (req.body[[subGameType] + '_twoSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;
                        let same2ColorYR = (req.body[[subGameType] + '_twoSameRow_Yellow_Red'] == 'true') ? arrSameColorType.push('Yellow_Red') : 0;
                        let same2ColorYG = (req.body[[subGameType] + '_twoSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                        let same2ColorGR = (req.body[[subGameType] + '_twoSameRow_Green_Red'] == 'true') ? arrSameColorType.push('Green_Red') : 0;
                        let same2ColorGY = (req.body[[subGameType] + '_twoSameRow_Green_Yellow'] == 'true') ? arrSameColorType.push('Green_Yellow') : 0;

                        let same3ColorRY = (req.body[[subGameType] + '_threeSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                        let same3ColorYG = (req.body[[subGameType] + '_threeSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                        let same3ColorRG = (req.body[[subGameType] + '_threeSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;

                        let optionCreate = [];

                        let ticketColorTypesNo = [];

                        for (let i = 0; i < arrTicketColorType.length; i++) {

                            let ticketCount = 0;
                            let ticketPrice = 0;

                            if (arrTicketColorType[i] == "Small White") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallWhite'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallWhiteColor']);
                            } else if (arrTicketColorType[i] == "Large White") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeWhite'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeWhiteColor']);
                            } else if (arrTicketColorType[i] == "Small Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallYellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallYellowColor']);
                            } else if (arrTicketColorType[i] == "Large Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeYellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeYellowColor']);
                            } else if (arrTicketColorType[i] == "Small Purple") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallPurple'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallPurpleColor']);
                            } else if (arrTicketColorType[i] == "Large Purple") {
                                ticketPrice = Number(req.body[[subGameType] + '_largePurple'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largePurpleColor']);
                            } else if (arrTicketColorType[i] == "Small Blue") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallBlue'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallBlueColor']);
                            } else if (arrTicketColorType[i] == "Large Blue") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeBlue'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeBlueColor']);
                            } else if (arrTicketColorType[i] == "Elvis 1") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis1'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis1Color']);
                            } else if (arrTicketColorType[i] == "Elvis 2") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis2'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis2Color']);
                            } else if (arrTicketColorType[i] == "Elvis 3") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis3'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis3Color']);
                            } else if (arrTicketColorType[i] == "Elvis 4") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis4'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis4Color']);
                            } else if (arrTicketColorType[i] == "Elvis 5") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis5'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis5Color']);
                            } else if (arrTicketColorType[i] == "Red") {
                                ticketPrice = Number(req.body[[subGameType] + '_red'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_redColor']);
                            } else if (arrTicketColorType[i] == "Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_yellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_yellowColor']);
                            } else if (arrTicketColorType[i] == "Green") {
                                ticketPrice = Number(req.body[[subGameType] + '_green'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_greenColor']);
                            }


                            let eightColorFlg = false;
                            var indx = ETICKETCOLORS.findIndex(row => row == arrTicketColorType[i]);
                            if (indx >= 0) {
                                eightColorFlg = true;
                            }


                            let saveObj = {}

                            let ColorName = (arrTicketColorType[i] == "Small White") ? "smallWhite" : (arrTicketColorType[i] == "Large White") ? "largeWhite" : (arrTicketColorType[i] == "Small Yellow") ? "smallYellow" : (arrTicketColorType[i] == "Large Yellow") ? "largeYellow" : (arrTicketColorType[i] == "Small Purple") ? "smallPurple" : (arrTicketColorType[i] == "Large Purple") ? "largePurple" : (arrTicketColorType[i] == "Small Blue") ? "smallBlue" : (arrTicketColorType[i] == "Large Blue") ? "largeBlue" : (arrTicketColorType[i] == "Elvis 1") ? "elvis1" : (arrTicketColorType[i] == "Elvis 2") ? "elvis2" : (arrTicketColorType[i] == "Elvis 3") ? "elvis3" : (arrTicketColorType[i] == "Elvis 4") ? "elvis4" : (arrTicketColorType[i] == "Elvis 5") ? "elvis5" : (arrTicketColorType[i] == "Red") ? "red" : (arrTicketColorType[i] == "Yellow") ? "yellow" : (arrTicketColorType[i] == "Green") ? "green" : "";

                            ticketColorTypesNo.push({
                                ticketName: arrTicketColorType[i],
                                ticketType: ColorName,
                                ticketPrice: ticketPrice,
                                ticketCount: ticketCount
                            });



                            //saveObj[ColorName] 
                            saveObj = {
                                ticketName: arrTicketColorType[i],
                                ticketType: ColorName,
                                ticketPrice: ticketPrice,
                                ticketCount: ticketCount,
                                totalPurchasedTickets: 0,
                                isEightColors: eightColorFlg,
                                jackpot: {
                                    price: Number(req.body['jackpotPrice' + [subGameType]]),
                                    draw: Number(req.body['jackpotDraws' + [subGameType]])
                                },
                            }

                            let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                            //let winning = {};
                            let winning = [];
                            let tmpBody = req.body;
                            let rowPattern = subGameRowData.patternRow;
                            for (let j = 0; j < rowPattern.length; j++) {

                                let tmpObj = {
                                    winningPatternName: rowPattern[j].name,
                                    winningPatternType: rowPattern[j].patType,
                                    pattern: rowPattern[j].patternType,
                                    isWoF: rowPattern[j].isWoF,
                                    isTchest: rowPattern[j].isTchest,
                                    isMys: rowPattern[j].isMys,
                                    extraPercent: rowPattern[j].rowPercentage,
                                    status: rowPattern[j].status,
                                    isJackpot: rowPattern[j].isJackpot
                                }

                                if (arrTicketColorType[i] == "Small White" || arrTicketColorType[i] == "Large White" || arrTicketColorType[i] == "Small Yellow" || arrTicketColorType[i] == "Large Yellow" || arrTicketColorType[i] == "Small Purple" || arrTicketColorType[i] == "Large Purple" || arrTicketColorType[i] == "Small Blue" || arrTicketColorType[i] == "Large Blue") {
                                    if (([subGameType] + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + [rowPattern[j].patType]] != '') { // This check this key in req.body if yes process other wise skip

                                        let extraWinnings = {}
                                        let tChest = {}

                                        if (tmpObj.isMys == true) {
                                            extraWinnings = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                            }
                                        }

                                        if (tmpObj.isTchest == true) {
                                            tChest = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                                prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                                prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                                prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                                prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                                prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                                prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                                prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                            }
                                        }

                                        tmpObj.extraWinningsTchest = tChest;
                                        //tmpObj[rowPattern[j].patType] = Number(tmpBody[[subGameType] + [rowPattern[j].patType]])
                                        tmpObj.winningValue = Number(tmpBody[[subGameType] + [rowPattern[j].patType]]);
                                        tmpObj.extraWinnings = extraWinnings;
                                        //winning[rowPattern[j].patType] = tmpObj;
                                        winning.push(tmpObj);

                                    }

                                } else if (arrTicketColorType[i] == "Elvis 1" || arrTicketColorType[i] == "Elvis 2" || arrTicketColorType[i] == "Elvis 3" || arrTicketColorType[i] == "Elvis 4" || arrTicketColorType[i] == "Elvis 5" || arrTicketColorType[i] == "Red" || arrTicketColorType[i] == "Yellow" || arrTicketColorType[i] == "Green") {
                                    if (([subGameType] + '_' + ColorName + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + '_' + ColorName + [rowPattern[j].patType]] != '') {
                                        let tChest = {}
                                        let extraWinnings = {};

                                        if (tmpObj.isMys == true) {
                                            extraWinnings = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                            }
                                        }

                                        if (tmpObj.isTchest == true) {
                                            tChest = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                                prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                                prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                                prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                                prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                                prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                                prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                                prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                            }
                                        }

                                        tmpObj.extraWinningsTchest = tChest;
                                        //tmpObj[rowPattern[j].patType] = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]])
                                        tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);
                                        tmpObj.extraWinnings = extraWinnings;
                                        //winning[rowPattern[j].patType] = tmpObj;
                                        winning.push(tmpObj);

                                    }
                                }
                            }
                            //saveObj[ColorName].winning = winning;
                            saveObj.winning = winning;
                            optionCreate.push(saveObj);

                        }

                        let obj = {
                            //[subGameType]: {
                            subGameId: subGameId,
                            gameName: subGameName,
                            gameType: subGameType,
                            ticketColorTypes: arrTicketColorType,
                            ticketColorTypesNo: ticketColorTypesNo,
                            jackpotValues: {
                                price: Number(req.body['jackpotPrice' + [subGameType]]),
                                draw: Number(req.body['jackpotDraws' + [subGameType]])
                            },
                            options: optionCreate
                                //}
                        }
                        storeGamesData.push(obj);


                        // Same Color save
                        let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                        for (let k = 0; k < arrSameColorType.length; k++) {
                            let saveObj = {};
                            //let winning = {};
                            let winning = [];
                            let tmpBody = req.body;
                            let rowPattern = subGameRowData.patternRow;

                            let strLtd = arrSameColorType[k];
                            let splitColor = strLtd.split('_');
                            let nameColor1 = splitColor[0];
                            let nameColor2 = splitColor[1];

                            for (let j = 0; j < rowPattern.length; j++) {

                                let tmpObj = {
                                    pattern: rowPattern[j].patternType,
                                    isWoF: rowPattern[j].isWoF,
                                    isTchest: rowPattern[j].isTchest,
                                    isMys: rowPattern[j].isMys,
                                    extraPercent: rowPattern[j].rowPercentage,
                                    status: rowPattern[j].status,
                                    isJackpot: rowPattern[j].isJackpot
                                }

                                let extraWinnings = {};
                                if (tmpObj.isMys == true) {
                                    extraWinnings = {
                                        prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                        prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                        prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                        prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                        prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                    }
                                }

                                tmpObj[rowPattern[j].patType] = {
                                    [nameColor1.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor1 + '_' + [rowPattern[j].patType]]),
                                    [nameColor2.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor2 + '_' + [rowPattern[j].patType]]),
                                }

                                let tChest = {};
                                if (tmpObj.isTchest == true) {
                                    tChest = {
                                        prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                        prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                        prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                        prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                        prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                        prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                        prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                        prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                        prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                        prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                        prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                        prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                    }
                                }

                                tmpObj.extraWinningsTchest = tChest;
                                tmpObj.extraWinnings = extraWinnings;
                                // winning[rowPattern[j].patType] = tmpObj;
                                winning.push(tmpObj);
                            }

                            saveObj = {
                                subGameId: subGameId,
                                gameName: subGameName,
                                gameType: subGameType,
                                type: subGameType + "_" + arrSameColorType[k],
                                gameColorsCmbName: subGameType+" "+nameColor1+" & "+nameColor2, 
                                winning: winning
                            }

                            trafficLightOption.push(saveObj);
                        }

                    }
                }


                let hallArray = [];
                let hall = req.body.hallSelecteds;
                let hallData, hallObj = {};
                let allHallTabaleId = [];

                if (typeof(hall) === 'string') {
                    console.log("hall", hall);
                    let hallId = await Sys.Helper.bingo.obId(hall);
                    hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                    if (!hallData) {
                        req.flash('error', 'Hall Not Found');
                        return res.redirect('/agent');
                    } else {
                        hallObj = {
                            _id: hallData._id,
                            name: hallData.name,
                            hallId: hallData.hallId,
                            status: hallData.status
                        }
                        hallArray.push(hallObj);
                        allHallTabaleId.push(hallData._id);
                    }
                } else {
                    for (let i = 0; i < hall.length; i++) {
                        let hallId = await Sys.Helper.bingo.obId(hall[i]);
                        hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                        if (!hallData) {
                            req.flash('error', 'Hall Not Found');
                            return res.redirect('/agent');
                        } else {
                            hallObj = {
                                _id: hallData._id,
                                name: hallData.name,
                                hallId: hallData.hallId,
                                status: hallData.status
                            }
                            hallArray.push(hallObj);
                            allHallTabaleId.push(hallData._id);
                        }
                    }
                }

                let masterObj = {};
                if (typeof(req.body.masterHallSelected) === 'string') {
                    let hallId = await Sys.Helper.bingo.obId(req.body.masterHallSelected);
                    hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                    if (!hallData) {
                        req.flash('error', 'Hall Not Found');
                        return res.redirect('/gameManagement');
                    } else {
                        masterObj = {
                            _id: hallData._id,
                            name: hallData.name,
                            hallId: hallData.hallId,
                            status: hallData.status
                        }
                    }
                }

                game = await Sys.App.Services.GameService.insertGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game1',
                    gameNumber: createID + '_G1',
                    gameType: gameType.type,
                    status: "active",
                    day: req.body.day,
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    startDate: req.body.start_date,
                    graceDate: req.body.grace_time,
                    minTicketCount: req.body.minTicketCount,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    seconds: req.body.seconds * 1000,
                    trafficLightExtraOptions: trafficLightOption,
                    subGames: storeGamesData,
                    halls: hallArray,
                    allHallsId: allHallTabaleId,
                    masterHall: masterObj,
                    isMasterGame: true,
                    isSubGame: false
                });

                for (let o = 0; o < storeGamesData.length; o++) {

                    let SubGameAdd = await Sys.App.Services.GameService.insertGameData({
                        gameMode: req.body.gameMode,
                        gameName: 'Game1',
                        gameNumber: createID + '_G1',
                        gameType: gameType.type,
                        status: "active",
                        day: req.body.day,
                        gameTypeId: req.params.typeId,
                        createrId: req.session.details.id,
                        startDate: req.body.start_date,
                        graceDate: req.body.grace_time,
                        minTicketCount: req.body.minTicketCount,
                        notificationStartTime: req.body.notificationStartTime,
                        luckyNumberPrize: req.body.luckyNumberPrize,
                        seconds: req.body.seconds * 1000,
                        trafficLightExtraOptions: trafficLightOption,
                        subGames: storeGamesData[o],
                        halls: hallArray,
                        allHallsId: allHallTabaleId,
                        masterHall: masterObj,
                        isMasterGame: false,
                        parentGameId: game._id,
                        isSubGame: true
                    });

                }


                updateGame = await Sys.App.Services.GameService.updateSaveGameData({_id:GameId._id},{
                    gameMode: req.body.gameMode,
                    gameName: 'Game1',
                    gameNumber: createID + '_G1',
                    gameType: gameType.type,
                    status: "active",
                    day: req.body.day,
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    startDate: req.body.start_date,
                    graceDate: req.body.grace_time,
                    minTicketCount: req.body.minTicketCount,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    seconds: req.body.seconds * 1000,
                    trafficLightExtraOptions: trafficLightOption,
                    subGames: storeGamesData,
                    halls: hallArray,
                    allHallsId: allHallTabaleId,
                    masterHall: masterObj,
                    isMasterGame: true,
                    isSubGame: false
                });




            } else if (gameType.type == "game_2") {

                updateGame = await Sys.App.Services.GameService.getSingleSavedGameData({ _id: req.params.id });

                if (updateGame != undefined) {
                    let data = {
                        startDate: req.body.start_date,
                        graceDate: req.body.grace_time,
                        day: req.body.day,
                        gameMode: req.body.gameMode,
                        minTicketCount: req.body.minTicketCount,
                        totalNoTickets: req.body.totalNoTickets,
                        notificationStartTime: req.body.notificationStartTime,
                        luckyNumberPrize: req.body.luckyNumberPrize,
                        ticketPrice: req.body.ticketPrice,
                        seconds: req.body.seconds * 1000,
                        jackPotNumber: {
                            9: req.body.priceNine,
                            10: req.body.priceTen,
                            11: req.body.priceEleven,
                            12: req.body.priceTwelve,
                            13: req.body.priceThirteen,
                            1421: req.body.priceFourteenToTwentyone,
                        },
                    }
                    let game = await Sys.App.Services.GameService.updateSaveGameData({ _id: req.params.id }, data);
                    //console.log('game: ', game);

                    // [ Real Game Create Here ]

                    let query = { _id: game.gameTypeId };
                    let gameType = await Sys.App.Services.GameService.getGameTypeById(query);
                    //console.log("gameType", gameType);


                    let gameUpdated = await Sys.App.Services.GameService.insertGameData({
                        gameMode: game.gameMode,
                        gameName: game.gameName,
                        gameNumber: createID + '_G2',
                        gameType: game.gameType,
                        status: game.status,
                        day: game.day,
                        gameTypeId: game.gameTypeId,
                        createrId: req.session.details.id,
                        startDate: req.body.start_date,
                        graceDate: req.body.grace_time,
                        minTicketCount: game.minTicketCount,
                        totalNoTickets: game.totalNoTickets,
                        notificationStartTime: game.notificationStartTime,
                        luckyNumberPrize: game.luckyNumberPrize,
                        ticketPrice: game.ticketPrice,
                        seconds: game.seconds,
                        jackPotNumber: game.jackPotNumber
                    });

                    var sendData = {
                        columns: gameType.columns,
                        slug: gameType.type,
                        ticketSize: gameUpdated.totalNoTickets,
                        gameId: gameUpdated._id
                    }

                    console.log("sendData: ", sendData);

                    var ticketBook = await Sys.Helper.bingo.ticketBook(sendData);

                }
            } else if (gameType.type == "game_3") {
                updateGame = await Sys.App.Services.GameService.getSingleSavedGameData({ _id: req.params.id });

                if (updateGame != undefined) {
                    var patternGroupNumberPrize = [];
                    let data = {
                        startDate: req.body.start_date,
                        graceDate: req.body.grace_time,
                        day: req.body.day,
                        minTicketCount: req.body.minTicketCount,
                        totalNoTickets: req.body.totalNoTickets,
                        totalNoPurchasedTickets: req.body.totalNoTickets,
                        notificationStartTime: req.body.notificationStartTime,
                        luckyNumberPrize: req.body.luckyNumberPrize,
                        ticketPrice: req.body.ticketPrice,
                        patternGroupNumberPrize: patternGroupNumberPrize,
                        seconds: req.body.seconds * 1000
                    }
                    await Sys.App.Services.GameService.updateSaveGameData({ _id: req.params.id }, data)
                }
            } else if (gameType.type == "game_4") {

                updateGame = await Sys.App.Services.GameService.getSingleSavedGameData({ _id: req.params.id });

                var newArrayBetAmount = req.body.betAmount.map(function(x) {
                    return parseInt(x, 10);
                });

                let n = 3; // [ Array Rows ]

                let arr1 = [];
                let arr2 = [];
                let arr3 = [];
                let arr4 = [];

                let cntt = 0;
                for (let i = 0; i < newArrayBetAmount.length; i++) {
                    let index = newArrayBetAmount.indexOf(newArrayBetAmount[i]);

                    if (cntt == n) {
                        arr1.push(newArrayBetAmount[i]);
                        cntt = 0;
                    } else if (cntt == (n - 1)) {
                        arr2.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    } else if (cntt == (n - 2)) {
                        arr3.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    } else {
                        arr4.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    }
                }

                let result = [
                    [...arr4],
                    [...arr3],
                    [...arr2],
                    [...arr1]
                ];
                console.log('Result: ', result);

                let json = {};
                for (let i = 0; i < 4; i++) {
                    json['ticket' + (i + 1) + 'Multiplier'] = result[i];
                }
                console.log("JSON: ", json);

                if (updateGame != undefined) {
                    game = await Sys.App.Services.GameService.updateSaveGameData({ _id: req.params.id }, {
                        betAmount: req.body.betAmount,
                        ticketPrice: 1, //req.body.ticketPrice,
                        betMultiplier: req.body.betMultiplier,
                        betData: json,
                        day: req.body.day,
                        seconds2: req.body.seconds2 * 1000,
                        seconds: req.body.seconds * 1000,
                        patternNamePrice: {
                            'Pattern1': req.body.Pattern1,
                            'Pattern2': req.body.Pattern2,
                            'Pattern3': req.body.Pattern3,
                            'Pattern4': req.body.Pattern4,
                            'Pattern5': req.body.Pattern5,
                            'Pattern6': req.body.Pattern6,
                            'Pattern7': req.body.Pattern7,
                            'Pattern8': req.body.Pattern8,
                            'Pattern9': req.body.Pattern9,
                            'Pattern10': req.body.Pattern10,
                            'Pattern11': req.body.Pattern11,
                            'Pattern12': req.body.Pattern12,
                            'Pattern13': req.body.Pattern13,
                            'Pattern14': req.body.Pattern14,
                            'Pattern15': req.body.Pattern15
                        }
                    });
                    console.log('game: ', game);
                }
            }

            if (!updateGame) {
                req.flash('error', 'Game was not updated');
                return res.redirect('/savedGameList');
            } else {
                req.flash('success', 'Game was updated successfully');
                return res.redirect('/savedGameList');
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    getSaveGameManagementDelete: async function(req, res) {
        try {
            let game = await Sys.App.Services.GameService.getSingleSavedGameData({ _id: req.body.id });
            if (game) {
                await Sys.App.Services.GameService.deleteSaveGame(req.body.id)
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    viewSaveGameManagementDetails: async function(req, res) {
        try {

            let dataGame = await Sys.App.Services.GameService.getByIdSavedGames({ _id: req.params.id });
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: dataGame.gameTypeId });

            var startDateAt = dateTimeFunction(dataGame.startDate);
            var graceDateAt = dateTimeFunction(dataGame.graceDate);

            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                // let ampm = hours >= 12 ? 'pm' : 'am';
                // hours = hours % 12;
                // hours = hours ? hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes;
                return dateTime; // Function returns the dateandtime
            }

            let subGameList = await Sys.App.Services.subGame1Services.getAllDataSelect({ status: 'active' }, { ticketColor: 1, gameName: 1, subGameId: 1, gameType: 1, allPatternRowId: 1 });
            let subGameColorRow = {};
            let rows = [];
            for (let s = 0; s < subGameList.length; s++) {
                for (let r = 0; r < subGameList[s].allPatternRowId.length; r++) {
                    rows.push(subGameList[s].allPatternRowId[r])
                }
            }
            for (let s = 0; s < subGameList.length; s++) {
                let obj = {};
                obj.colors = subGameList[s].ticketColor;
                obj.gameName = subGameList[s].gameName;
                obj.subGameId = subGameList[s].subGameId;
                obj.gameType = subGameList[s].gameType;
                subGameColorRow[subGameList[s].gameType] = obj;
            }

            console.log(" subGameColorRow subGameColorRow : ",subGameColorRow)


            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                savedGameList: 'active',
                Game: dataGame,
                StartDate: startDateAt,
                GraceTime: graceDateAt,
                gameData: gameType,
                subGameColorRow : subGameColorRow
            };
            return res.render('savedGame/gameView', data);

        } catch (error) {
            console.log("Error viewSaveGameManagementDetails", error);
        }
    },

    // [ Old Documention wise ] Game Menu 

    viweGameMenu: async function(req, res) {
        try {

            var gameType = await Sys.App.Services.GameService.getByDataSortGameType({});

            //console.log("gameType", gameType);
            var gameData = [];
            var dataGame = {};
            for (var i = 0; i < gameType.length; i++) {
                dataGame = {
                    _id: gameType[i]._id,
                    name: gameType[i].name,
                }
                gameData.push(dataGame);
            }

            return res.send({
                status: 'success',
                data: gameData,
                GameMenu: 'active',
                DataOfGames: gameData
            });
        } catch (error) {
            Sys.Log.error('Error in gameType: ', error);
            return new Error(error);
        }
    },

    viweGameDetail: async function(req, res) {
        try {
            // console.log("Req.params calling");
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });
            //console.log("gameType", gameType);
            var theadField;
            if (gameType.type == "game_1") {
                theadField = [

                ]
            } else if (gameType.type == "game_2") {
                theadField = [
                    'Game number',
                    'Start Date and Time',
                    'Ticket price',
                    'Jack pot number',
                    'Price in number',
                    'Seconds',
                    'Action'
                ]

            } else if (gameType.type == "game_3") {
                theadField = [
                    'Game number',
                    'Start Date and Time',
                    'Ticket price',
                    'Seconds',
                    'Game Type',
                    'Action'
                ]
            } else if (gameType.type == "game_4") {
                theadField = [

                ]
            } else {
                req.flash('error', 'Game Not Found');
                return res.redirect('/dashboard');
            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                gameData: gameType,
                theadField: theadField
            };
            // res.send(data);
            return res.render('GameFolder/gameDetail', data);

        } catch (error) {
            Sys.Log.error('Error in viweGameDetail: ', error);
            return new Error(error);
        }
    },

    getGameDetailList: async function(req, res) {
        try {
            console.log("getGameDetailList calling", req.query.gameType);

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            var gameName;

            if (req.query.gameType == "game_1") {
                gameName = "Game1";
            } else if (req.query.gameType == "game_2") {
                gameName = "Game2";
            } else if (req.query.gameType == "game_3") {
                gameName = "Game3";
            } else if (req.query.gameType == "game_4") {
                gameName = "Game4";
            }

            let query = { gameName: gameName };
            if (search != '') {
                query = { gameNumber: { $regex: '.*' + search + '.*' }, gameName: gameName };
            }

            // let startTo = new Date(req.query.start_date);
            // let endFrom = new Date(req.query.end_date);
            // endFrom.setHours(23, 59, 59);

            // if (req.query.is_date_search == "yes" && search == '') {
            //     query = { createdAt: { $gte: startTo, $lt: endFrom } };
            // }

            // if (req.query.is_date_search == "yes" && search != '') {
            //     query = { fullName: { $regex: '.*' + search + '.*' }, createdAt: { $gte: startTo, $lt: endFrom } };
            // }

            //console.log(query);
            let reqCount = await Sys.App.Services.GameService.getSelectedGameCount(query);

            let data = await Sys.App.Services.GameService.getGameDatatable(query, length, start);


            if (req.query.gameType == "game_1") {

            } else if (req.query.gameType == "game_2") {
                var gameData = [];

                for (var i = 0; i < data.length; i++) {
                    var dataGame = {
                        _id: data[i]._id,
                        gameNumber: data[i].gameNumber,
                        startDate: data[i].startDate,
                        ticketPrice: data[i].ticketPrice,
                        jackPotNumber: data[i].jackPotNumber[0],
                        priceNumber: data[i].jackPotNumber[0],
                        seconds: data[i].seconds,
                    }
                    gameData.push(dataGame);
                }

            } else if (req.query.gameType == "game_3") {
                var gameData = [];

                for (var i = 0; i < data.length; i++) {
                    var dataGame = {
                        _id: data[i]._id,
                        gameNumber: data[i].gameNumber,
                        startDate: data[i].startDate,
                        ticketPrice: data[i].ticketPrice,
                        seconds: data[i].seconds,
                    }
                    gameData.push(dataGame);
                }

            } else if (req.query.gameType == "game_4") {

            }

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': gameData,
            };

            //console.log("data:::::::::::::", data)

            res.send(obj);

        } catch (error) {
            Sys.Log.error('Error in getGameDetailList: ', error);
            return new Error(error);
        }
    },

    addGame: async function(req, res) {
        try {
            //console.log("addGame", req.params.id);
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });
            //console.log("gameType addGame", gameType);

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameMenu: 'active',
                gameData: gameType,
                slug: 'Add'
            };
            return res.render('GameFolder/addGame', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    addGamePostData: async function(req, res) {
        try {
            //console.log("addGamePostData params", req.params.typeId, req.params.type);
            console.log("addGamePostData", req.body);
            let randomNumber = Math.floor(100000 + Math.random() * 900000);

            var game;

            if (req.params.type == "game_1") {

            } else if (req.params.type == "game_2") {
                game = await Sys.App.Services.GameService.insertGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game2',
                    gameNumber: randomNumber + Date.now() + '-Game2ID',
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    startDate: req.body.start_date,
                    graceDate: req.body.grace_time,
                    minTicketCount: req.body.minTicketCount,
                    totalNoTickets: req.body.totalNoTickets,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    ticketPrice: req.body.ticketPrice,
                    seconds: req.body.seconds * 1000,
                    jackPotNumber: {
                        9: req.body.priceNine,
                        10: req.body.priceTen,
                        11: req.body.priceEleven,
                        12: req.body.priceTwelve,
                        13: req.body.priceThirteen,
                        1421: req.body.priceFourteenToTwentyone,
                    }
                });
            } else if (req.params.type == "game_3") {
                var patternGroupNumberPrize = [];
                game = await Sys.App.Services.GameService.insertGameData({
                    gameName: 'Game3',
                    gameNumber: randomNumber + Date.now() + '-Game3ID',
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    startDate: req.body.start_date,
                    ticketPrice: req.body.ticketPrice,
                    patternGroupNumberPrize: patternGroupNumberPrize,
                    seconds: req.body.seconds * 1000,
                });

                game = JSON.stringify(game);
                // let shakti = await redisClient.set('game3' + game._id, game);
                // let shiv = await redisClient.get('Rooms');

            } else if (req.params.type == "game_4") {

            }

            if (!game) {
                req.flash('error', 'Game was not created');
                return res.redirect('/gameDetailList/' + req.params.typeId);
            } else {
                req.flash('success', 'Game was create successfully');
                return res.redirect('/gameDetailList/' + req.params.typeId);
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    editGame: async function(req, res) {
        try {
            //console.log("editGame", req.params);

            let Game = await Sys.App.Services.GameService.getById({ _id: req.params.id });
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });

            var startDateAt = dateTimeFunction(Game.startDate);
            var graceDateAt = dateTimeFunction(Game.graceDate);

            function dateTimeFunction(dateData) {
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
                let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes + ' ' + ampm;
                return dateTime; // Function returns the dateandtime
            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameMenu: 'active',
                Game: Game,
                StartDate: startDateAt,
                GraceTime: graceDateAt,
                gameData: gameType
            };
            return res.render('GameFolder/addGame', data);

        } catch (e) {
            console.log("Error", e);
        }
    },


    editGamePostData: async function(req, res) {
        try {

            // console.log("editGamePostData", req.params);

            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });
            let updateGame;

            if (gameType.type == "game_1") {

            } else if (gameType.type == "game_2") {
                updateGame = await Sys.App.Services.GameService.getSingleGameData({ _id: req.params.id });

                if (updateGame != undefined) {
                    let data = {
                        startDate: req.body.start_date,
                        graceDate: req.body.grace_time,
                        minTicketCount: req.body.minTicketCount,
                        totalNoTickets: req.body.totalNoTickets,
                        notificationStartTime: req.body.notificationStartTime,
                        luckyNumberPrize: req.body.luckyNumberPrize,
                        ticketPrice: req.body.ticketPrice,
                        seconds: req.body.seconds * 1000,
                        jackPotNumber: {
                            9: req.body.priceNine,
                            10: req.body.priceTen,
                            11: req.body.priceEleven,
                            12: req.body.priceTwelve,
                            13: req.body.priceThirteen,
                            1421: req.body.priceFourteenToTwentyone,
                        },
                    }
                    await Sys.App.Services.GameService.updateGameData({ _id: req.params.id }, data)
                    var gameType = await Sys.App.Services.GameService.getByIdGameType();

                }
            } else if (gameType.type == "game_3") {
                updateGame = await Sys.App.Services.GameService.getSingleGameData({ _id: req.params.id });

                if (updateGame != undefined) {
                    var patternGroupNumberPrize = [];
                    let data = {
                        startDate: req.body.start_date,
                        graceDate: req.body.grace_time,
                        minTicketCount: req.body.minTicketCount,
                        totalNoTickets: req.body.totalNoTickets,
                        notificationStartTime: req.body.notificationStartTime,
                        luckyNumberPrize: req.body.luckyNumberPrize,
                        ticketPrice: req.body.ticketPrice,
                        patternGroupNumberPrize: patternGroupNumberPrize,
                        seconds: req.body.seconds * 1000
                    }
                    await Sys.App.Services.GameService.updateGameData({ _id: req.params.id }, data)
                }
            } else if (gameType.type == "game_4") {

            }

            if (!updateGame) {
                req.flash('error', 'Game was not updated');
                return res.redirect('/gameDetailList/' + req.params.typeId);
            } else {
                req.flash('success', 'Game was updated successfully');
                return res.redirect('/gameDetailList/' + req.params.typeId);
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    getGameDelete: async function(req, res) {
        try {
            let player = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.id });
            if (player || player.length > 0) {
                await Sys.App.Services.GameService.deleteGame(req.body.id)
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    viewGameDetails: async function(req, res) {
        try {
            let dataGame = await Sys.App.Services.GameService.getById({ _id: req.params.id });
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });

            var startDateAt = dateTimeFunction(dataGame.startDate);
            var graceDateAt = dateTimeFunction(dataGame.graceDate);

            function dateTimeFunction(dateData) {
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
                let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes + ' ' + ampm;
                return dateTime; // Function returns the dateandtime
            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameMenu: 'active',
                Game: dataGame,
                StartDate: startDateAt,
                GraceTime: graceDateAt,
                gameData: gameType
            };
            return res.render('GameFolder/viewGameDetails', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

}