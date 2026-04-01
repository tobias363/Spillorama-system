var Sys = require('../../Boot/Sys');
var bcrypt = require('bcryptjs');
var mongoose = require('mongoose');
const { json } = require('body-parser');
module.exports = {
    uniqueIdReport: async function (req, res) {
        try {
            // let dataQuery=[];
            // let agentQuery=[];


            // if(req.session.details && req.session.details.role=='agent'){
            //     dataQuery=[
            //         {
            //             $match:{
            //                 isAgentTicket:true,
            //                 agentId: req.session.details.id
            //             }
            //         }
            //     ]
            // }




            // agentQuery=[
            //     {
            //         $match: {
            //             userType: "Unique",
            //             playerTicketType:"Online"
            //         }
            //     },
            //     {
            //         $group: {
            //             _id: {
            //                 "userType": "$userType",

            //             },
            //             ticketsPrice: { "$sum": '$ticketPrice' },
            //         }
            //     },
            //     {
            //         $project: {
            //             ticketsPrice: '$ticketsPrice'
            //         }
            //     }
            //     ];

            //     dataQuery= dataQuery.concat(agentQuery);

            //    console.log("+++++++++++++++++++++++++ : ",agentQuery)
            //    console.log("++++++++++ dataQuery +++++ dataQuery ++++++++++ : ",dataQuery)

            //     let totalTicketPrice = await Sys.App.Services.GameService.aggregateQueryTickets(dataQuery);
            //     console.log("+++++++++uniqueIdReport uniqueIdReport :",totalTicketPrice)
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Report Management'] || [];
                let stringReplace =req.session.details.isPermission['Report Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // let stringReplace = req.session.details.isPermission['Report Management'];

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            let keys = [
                "unique_ticket_report",
                "table",
                "game",
                "unique_id",
                "dashboard",
                "ticket_number",
                "group_of_hall_name",
                "ticket_purchase_date",
                "search_id",
                "hall_name",
                "game_id",
                "game_type",
                "real",
                "bot",
                "group_of_hall",
                "game_name",
                "ticket_color_type",
                "ticket_price",
                "search",
                "reset",
                "show",
                "entries",
                "previous",
                "next",
                "result",
                "total_amount_received_by_selling_ticket"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                error: req.flash("error"),
                success: req.flash("success"),
                //totalTicketPrice:totalTicketPrice,
                ReportMenu: "active",
                reportUniqueTicket: "active",
                Agent: req.session.details,
                gameReport: translate,
                navigation: translate
            };
            if(viewFlag){
                return res.render('report/unique1reports.html', data);
            }else{
                req.flash('error',await Sys.Helper.bingo.getTraslateData(["you_are_not_allowed_to_access_that_page"], req.session.details.language)) //'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }
        } catch (err) {
            console.log("Error in uniqueIdReport", e);
            return new Error(e);
        }
    },

    physicalTicketReport: async function (req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Report Management'] || [];
                let stringReplace =req.session.details.isPermission['Report Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // let stringReplace = req.session.details.isPermission['Report Management'];

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            let keys = [
                "physical_ticket_report",
                "table",
                "dashboard",
                "ticket_number",
                "group_of_hall_name",
                "start_date_Time",
                "hall_name",
                "game_id",
                "game_type",
                "real",
                "bot",
                "group_of_hall",
                "game_name",
                "ticket_color_type",
                "ticket_price",
                "search",
                "reset",
                "show",
                "entries",
                "previous",
                "next",
                "order_from_date_alert",
                "order_to_date_alert",
                "result",
                "total_amount_received_by_selling_ticket"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let dataQuery = [];
            let agentQuery = [];


            if (req.session.details && req.session.details.role == 'agent') {
                dataQuery = [
                    {
                        $match: {
                            isAgentTicket: true,
                            agentId: req.session.details.id,
                            hallId: req.session.details.hall[0].id
                        }
                    }
                ]
            }

            agentQuery = [
                {
                    $match: {
                        playerTicketType: "Physical",
                    }
                },
                {
                    $group: {
                        _id: {
                            "playerTicketType": "$playerTicketType",

                        },
                        ticketsPrice: { "$sum": '$ticketPrice' },
                    }
                },
                {
                    $project: {
                        ticketsPrice: '$ticketsPrice'
                    }
                }
            ];

            dataQuery = dataQuery.concat(agentQuery);

            let totalTicketPrice = await Sys.App.Services.GameService.aggregateQueryTickets(dataQuery);
            console.log("+++++++++physicalTicketReport physicalTicketReport :", totalTicketPrice)
            var data = {
                App: Sys.Config.App.details,
                error: req.flash("error"),
                success: req.flash("success"),
                ReportMenu: "active",
                reportPhysicalTicket: "active",
                Agent: req.session.details,
                totalTicketPrice: totalTicketPrice,
                gameReport: translate,
                navigation: translate
            };
            if(viewFlag){
                return res.render('report/physicalTicketReport.html', data);
            }else{
                req.flash('error',await Sys.Helper.bingo.getTraslateData(["you_are_not_allowed_to_access_that_page"], req.session.details.language)) //'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }

        } catch (err) {
            console.log("Error in uniqueIdReport", e);
            return new Error(e);
        }
    },

    uniqueGameTicketReport: async function (req, res) {
        try {
            console.log(" req req uniqueGameTicketReport :", req.query)

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            //let query={userType: 'Unique',playerTicketType: {$in: ["Online", "Physical"] } };
            let query = {};
            if ((req.query.games).trim() != "game_1") {
                query = { userType: 'Unique' };
            } else {
                query = { userType: 'Unique' };  //, playerTicketType: { $in: ["Online", "Physical"] } 
            }
            if (search != '') {
                query.uniquePlayerId = { $regex: '.*' + search + '.*' };
            }
            if (req.query.games && req.query.games != '') {
                query.gameType = ((req.query.games).trim());
            }

            if ((req.query.games).trim() == "game_5") {
                if (req.session.details && req.session.details.role == 'agent') {
                    query.hallId = req.session.details.hall[0].id;
                }
            } else {
                if (req.session.details && req.session.details.role == 'agent') {
                    query.isAgentTicket = true;
                    query.agentId = req.session.details.id;
                    query.hallId = req.session.details.hall[0].id;
                }
            }


            if ((req.query.games).trim() == "game_5" || (req.query.games).trim() == "game_4") {
                query.isPurchased = true;
            }

            let sort = { _id: -1 };
            let ticketsCount = await Sys.App.Services.GameService.getTicketCount(query);
            let ticketInfo = await Sys.App.Services.GameService.getTicketDatatable(query, length, start, sort);

            console.log("+++++++++++++++++++++ : ", " game_1 ")

            let dataQuery = [];
            let agentQuery = [];
            if ((req.query.games).trim() == "game_5") {
                if (req.session.details && req.session.details.role == 'agent') {
                    dataQuery = [
                        {
                            $match: {
                                hallId: req.session.details.hall[0].id
                            }
                        }
                    ]
                }
            } else {
                if (req.session.details && req.session.details.role == 'agent') {
                    dataQuery = [
                        {
                            $match: {
                                isAgentTicket: true,
                                agentId: req.session.details.id,
                                hallId: req.session.details.hall[0].id
                            }
                        }
                    ]
                }
            }


            if ((req.query.games).trim() != "game_1") {
                agentQuery = [
                    {
                        $match: {
                            userType: "Unique",
                            gameType: (req.query.games).trim()
                        }
                    },
                    {
                        $group: {
                            _id: {
                                "userType": "$userType",

                            },
                            ticketsPrice: { "$sum": '$ticketPrice' },
                        }
                    },
                    {
                        $project: {
                            ticketsPrice: '$ticketsPrice'
                        }
                    }
                ];

            } else {
                agentQuery = [
                    {
                        $match: {
                            userType: "Unique",
                            gameType: (req.query.games).trim(),
                            // playerTicketType: { $in: ["Online", "Physical"] }
                        }
                    },
                    {
                        $group: {
                            _id: {
                                "userType": "$userType",

                            },
                            ticketsPrice: { "$sum": '$ticketPrice' },
                        }
                    },
                    {
                        $project: {
                            ticketsPrice: '$ticketsPrice'
                        }
                    }
                ];
                query = { userType: 'Unique' };  //, playerTicketType: { $in: ["Online", "Physical"] }
            }


            dataQuery = dataQuery.concat(agentQuery);

            console.log("+++++++++++++++++++++++++ : ", agentQuery)
            console.log("++++++++++ dataQuery +++++ dataQuery ++++++++++ : ", dataQuery)

            let totalTicketPrice = await Sys.App.Services.GameService.aggregateQueryTickets(dataQuery);
            console.log("+++++++++uniqueIdReport uniqueIdReport 1:", totalTicketPrice)
            let totalSell = 0;
            if (totalTicketPrice.length > 0) {
                totalSell = totalTicketPrice[0].ticketsPrice;
            }
            var obj = {
                'draw': req.query.draw,
                'recordsTotal': ticketsCount,
                'recordsFiltered': ticketsCount,
                'data': ticketInfo,
                'totalTicketPrice': totalSell
            };
            return res.send(obj);
        } catch (err) {
            console.log("Error in uniqueIdReport", e);
            return new Error(e);
        }
    },

    physicalGameTicketReport: async function (req, res) {
        try {
            console.log(" req req physicalGameTicketReport :", req.query)

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            let query = { playerTicketType: 'Physical' };

            if (search != '') {
                query.ticketId = { $regex: '.*' + search + '.*' };
            }
            let sort = { _id: -1 };

            if (req.session.details && req.session.details.role == 'agent') {
                query.isAgentTicket = true;
                query.agentId = req.session.details.id;
                query.hallId = req.session.details.hall[0].id;
            }

            let ticketsCount = await Sys.App.Services.GameService.getTicketCount(query);
            let ticketInfo = await Sys.App.Services.GameService.getTicketDatatable(query, length, start, sort);

            console.log("+++++++++++++++++++++ : ", " game_1 ")

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': ticketsCount,
                'recordsFiltered': ticketsCount,
                'data': ticketInfo,
            };
            return res.send(obj);
        } catch (err) {
            console.log("Error in uniqueIdReport", e);
            return new Error(e);
        }
    },

    reportGame1: async function (req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Report Management'] || [];
                let stringReplace =req.session.details.isPermission['Report Management'] || [];
                if(!stringReplace || !stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }

                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            let keys = [
                "game1_report",
                "dashboard",
                "from_date",
                "to_date",
                "start_date",
                "end_date",
                "group_of_hall_name",
                "hall_name",
                "search",
                "reset",
                "sub_game_id",
                "start_date_Time",
                "payout",
                "total_oms",
                "total_payout",
                "search_subgame_id",
                "show",
                "entries",
                "previous",
                "next",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                ReportMenu: "active",
                reportgame1: 'active',
                gameReport: translate,
                navigation: translate
            };

            if (viewFlag) {
                return res.render('report/game1reports', data);
            } else {
                req.flash('error',await Sys.Helper.bingo.getTraslateData(["you_are_not_allowed_to_access_that_page"], req.session.details.language)) //'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in reportGame1", e);
            return new Error(e);
        }
    },

    getReportGame1: async function (req, res) {
        try {
            console.log(" req.query req.query req.query :", req.query)

            let order = req.query.order;
            let sort = {};
            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1,
                }
            }

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            let groupHall = req.query.groupHall;
            let hallName = req.query.hall;
            if (req.session.details.role == 'agent') {
                hallName = req.session.details.hall[0].id
            }
            let dataQuery = [
                {
                    '$match': {
                        'gameType': 'game_1'
                    }
                }, {
                    '$lookup': {
                        'let': {
                            'hallObjId': {
                                '$toObjectId': '$hallId'
                            }
                        },
                        'from': 'hall',
                        'pipeline': [
                            {
                                '$match': {
                                    '$expr': {
                                        '$eq': [
                                            '$_id', '$$hallObjId'
                                        ]
                                    }
                                }
                            }, {
                                '$project': {
                                    '_id': 1,
                                    'name': 1
                                }
                            }
                        ],
                        'as': 'hallData'
                    }
                }, {
                    '$unwind': {
                        'path': '$hallData'
                    }
                }, {
                    '$lookup': {
                        'let': {
                            'groupHallObjId': {
                                '$toObjectId': '$groupHallId'
                            }
                        },
                        'from': 'groupHall',
                        'pipeline': [
                            {
                                '$match': {
                                    '$expr': {
                                        '$eq': [
                                            '$_id', '$$groupHallObjId'
                                        ]
                                    }
                                }
                            }, {
                                '$project': {
                                    '_id': 1,
                                    'name': 1
                                }
                            }
                        ],
                        'as': 'groupHallData'
                    }
                }, {
                    '$unwind': {
                        'path': '$groupHallData'
                    }
                }, {
                    '$group': {
                        '_id': {
                            'gameId': '$gameId',
                            'hallName': '$hallData.name'
                        },
                        'gameMode': {
                            '$first': '$gameMode'
                        },
                        'gameNumber': {
                            '$last': '$gameNumber'
                        },
                        'createdAt': {
                            '$last': '$createdAt'
                        },
                        'gameStartDate': {
                            '$first': '$gameStartDate'
                        },
                        'buyTicket': {
                            '$sum': {
                                '$cond': [
                                    {
                                        '$or': [
                                            {
                                                '$eq': [
                                                    '$game1Slug', 'buyTicket'
                                                ]
                                            }, {
                                                '$eq': [
                                                    '$game1Slug', 'replaceTicket'
                                                ]
                                            }
                                        ]
                                    }, '$typeOfTransactionTotalAmount', 0
                                ]
                            }
                        },
                        'cancelTicket': {
                            '$sum': {
                                '$cond': [
                                    {
                                        '$in': [
                                            '$game1Slug', ['cancelTicket', 'refund']
                                        ]
                                    }, '$typeOfTransactionTotalAmount', 0
                                ]
                            }
                        },
                        'groupHall': {
                            '$last': '$groupHallData'
                        },
                        'hall': {
                            '$last': '$hallData'
                        },
                        'winningPrice': {
                            '$sum': '$winningPrice'
                        }
                    }
                }, {
                    '$project': {
                        'gameMode': '$gameMode',
                        'gameNumber': '$gameNumber',
                        'gameStartDate': 1,
                        'totalNumberOfTicketSold': {
                            '$subtract': [
                                '$buyTicket', '$cancelTicket'
                            ]
                        },
                        'groupHall': '$groupHall',
                        'hall': '$hall',
                        'OMS': {
                            '$subtract': [
                                '$buyTicket', '$cancelTicket'
                            ]
                        },
                        'UTD': '$winningPrice'
                    }
                }, {
                    "$sort": sort
                }
            ]
            let fromDate = req.query.start_date;
            let toDate = req.query.end_date;

            if (fromDate) {
                let startOfToday = new Date(fromDate);
                fromDate = startOfToday.setHours(0, 0, 0, 0);
                dataQuery[0]['$match']['gameStartDate'] = { $gte: startOfToday };
            }
            if (toDate) {
                let endDate = new Date(toDate);
                toDate = endDate.setHours(23, 59, 59, 999);
                if (dataQuery[0]['$match']['gameStartDate']) {
                    dataQuery[0]['$match']['gameStartDate']['$lt'] = endDate;
                } else {
                    dataQuery[0]['$match']['gameStartDate'] = { $lt: endDate };
                }
            }

            if (search) {
                dataQuery[0]['$match']['gameNumber'] = { $regex: '.*' + search + '.*' }
            }

            if (hallName) {
                dataQuery[0]['$match']['hallId'] = hallName;
            }
            if (groupHall) {
                dataQuery[0]['$match']['groupHallId'] = groupHall;
            }
            // dataQuery = dataQuery.concat(tmp);
            console.log("query in game1report 1", JSON.stringify(dataQuery));
            let dataCntt = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(dataQuery);
            let totalOMS = dataCntt.reduce((a, b) => {
                return a + b.OMS
            }, 0);
            let totalUTD = dataCntt.reduce((a, b) => {
                return a + b.UTD
            }, 0);
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': dataCntt.length,
                'recordsFiltered': dataCntt.length,
                'data': dataCntt,
                'oms&utd': {
                    oms: totalOMS,
                    utd: totalUTD
                }
            };
            return res.send(obj);
        } catch (e) {
            console.log("Error in getReportGame1 API", e);
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': [],
                'oms&utd': {
                    oms: 0,
                    utd: 0
                }
            };
            return res.send(obj);
        }
    },

    reportGame1SubGames: async function (req, res) {
        try {
            let keys = []
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            console.log("req.params.id", req.params.id)
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Report Management'] || [];
                let stringReplace =req.session.details.isPermission['Report Management'] || [];

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                reportgame2: 'active',
                gameId: req.params.id,
                translate: translate,
                navigation: translate
            };

            if (viewFlag == true) {
                return res.render('report/subgame1reports', data);
            } else {
                req.flash('error',await Sys.Helper.bingo.getTraslateData(["you_are_not_allowed_to_access_that_page"], req.session.details.language)) //'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in reportGame1", e);
            return new Error(e);
        }
    },

    getGame1Subgames: async function (req, res) {
        try {

            let order = req.query.order;
            let sort = {};
            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1,
                }
            }

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;


            let parentGameId = await Sys.Helper.bingo.obId(req.query.gameId);
            let query = { gameName: "Game1", parentGameId: parentGameId };
            if (search != '') {
                query = { gameNumber: { $regex: '.*' + search + '.*' }, gameName: "Game1", parentGameId: parentGameId };
            }

            if (req.query.is_date_search == "yes") {
                let startTo = new Date(req.query.start_date);
                let endFrom = new Date(req.query.end_date);
                endFrom.setHours(23, 59, 59);
                query.createdAt = { $gte: startTo, $lt: endFrom }
            }
            console.log("report1 query", query)
            console.log("report1 query", query)
            if (sort.gameName) {
                sort = { 'subGames.0.gameName': sort.gameName }
            }
            if (sort.profitPercentage) {
                sort = { 'finalGameProfitAmount': sort.profitPercentage }
            }
            console.log("-----sort----", sort)
            let dataCntt = await Sys.App.Services.GameService.getSelectedGameCount(query)
            let data = await Sys.App.Services.GameService.getGamesByData(query, { gameNumber: 1, createdAt: 1, gameMode: 1, subGames: 1, startDate: 1, ticketSold: 1, earnedFromTickets: 1, totalWinning: 1, finalGameProfitAmount: 1, halls: 1 }, { sort: sort, limit: length, skip: start });

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': dataCntt,
                'recordsFiltered': dataCntt,
                'data': data,
            };
            res.send(obj);
        } catch (e) {
            console.log("Error", e);
        }
    },

    game1History: async function (req, res) {
        try {
            let keys = [
                "game_history",
                "dashboard",
                "game_player_view",
                "player_name",
                "group_of_hall_name",
                "ticket_color_type",
                "group_of_hall",
                "ticket_number",
                "ticket_price",
                "ticket_purchased_from",
                "winning_pattern",
                "total_winnings",
                "spin_wheel_winnings",
                "treasure_chest_winnings",
                "mystry_winnings",
                "unique_id",
                "game_name",
                "hall",
                "action",
                "hall_name",
                "search",
                "sub_game_id",
                "start_date_Time",
                "show",
                "entries",
                "previous",
                "next",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            console.log("In Game1History ::", req.params);
            let Game = await Sys.App.Services.GameService.getSingleGameData({ gameNumber: req.params.gameId });
            console.log("data", Game);
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                Game: Game,
                groupHall: Game.groupHalls,
                error: req.flash("error"),
                success: req.flash("success"),
                ReportMenu: "active",
                reportgame2: 'active',
                gameReport: translate,
                navigation: translate
            };
            return res.render('report/game1History', data);
        } catch (error) {
            console.log("Error in Game 1 history page :::", error);
            return res.send("error");
        }
    },

    reportGame2: async function (req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Report Management'] || [];
                let stringReplace =req.session.details.isPermission['Report Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Report Management'];
                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            let keys = [
                "game2_report",
                "dashboard",
                "from_date",
                "to_date",
                "real",
                "bot",
                "group_of_hall_name",
                "child_game_id",
                "game_id",
                "hall_name",
                "search",
                "reset",
                "sub_game_id",
                "start_date_Time",
                "payout",
                "total_oms",
                "total_payout",
                "search_subgame_id",
                "show",
                "entries",
                "previous",
                "next",
                "order_from_date_alert",
                "order_to_date_alert"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                reportgame2: 'active',
                ReportMenu: "active",
                gameReport: translate,
                navigation: translate
            };

            if (viewFlag) {
                return res.render('report/game2reports', data);
            } else {
                req.flash('error',await Sys.Helper.bingo.getTraslateData(["you_are_not_allowed_to_access_that_page"], req.session.details.language)) //'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in reportGame2", e);
            return new Error(e);
        }
    },

    getReportGame2: async function (req, res) {
        try {
            console.log("request data", req.params, req.query);
            let order = req.query.order;
            let sort = {};
            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1,
                }
            }

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            let groupHall = req.query.groupHall;
            let hallName = req.query.hallName;
            let startTo = new Date(req.query.start_date);
            let endFrom = new Date(req.query.end_date);
            endFrom.setHours(23, 59, 59);
            startTo.setHours(0, 0, 0);

            if (req.session.details.role == 'agent') {
                hallName = req.session.details.hall[0].id
            }

            let isBotGame = false;
            if (req.query.playerType == "bot") {
                isBotGame = true
            }

            const dataQuery = [
                {
                    '$match': {
                        'gameType': 'game_2',
                        'isBotGame': isBotGame,
                        'gameStartDate': { $gte: startTo, $lt: endFrom },
                        "defineSlug": { $nin: ['extraTransaction', 'leaderboard', 'loyalty'] },
                        "groupHall": { $exists: true },
                        "hall": { $exists: true }
                    }
                },

                // {
                //     '$lookup': {
                //         'let': {
                //             'hallObjId': {
                //                 '$toObjectId': '$hallId'
                //             }
                //         },
                //         'from': 'hall',
                //         'pipeline': [
                //             {
                //                 '$match': {
                //                     '$expr': {
                //                         '$eq': [
                //                             '$_id', '$$hallObjId'
                //                         ]
                //                     }
                //                 }
                //             }, {
                //                 '$project': {
                //                     '_id': 1,
                //                     'name': 1
                //                 }
                //             }
                //         ],
                //         'as': 'hallData'
                //     }
                // }, {
                //     '$unwind': {
                //         'path': '$hallData'
                //     }
                // }, {
                //     '$lookup': {
                //         'let': {
                //             'groupHallObjId': {
                //                 '$toObjectId': '$groupHallId'
                //             }
                //         },
                //         'from': 'groupHall',
                //         'pipeline': [
                //             {
                //                 '$match': {
                //                     '$expr': {
                //                         '$eq': [
                //                             '$_id', '$$groupHallObjId'
                //                         ]
                //                     }
                //                 }
                //             }, {
                //                 '$project': {
                //                     '_id': 1,
                //                     'name': 1
                //                 }
                //             }
                //         ],
                //         'as': 'groupHallData'
                //     }
                // }, {
                //     '$unwind': {
                //         'path': '$groupHallData'
                //     }
                // }, 
                {
                    '$project': {
                        'gameMode': 1,
                        'gameNumber': 1,
                        'gameStartDate': 1,
                        'createdAt': 1,
                        'defineSlug': 1,
                        'groupHall': 1,
                        'hall': 1,
                        'winningPrice': 1,
                        'ticketPrice': 1
                    }
                },
                {
                    '$group': {
                        '_id': {
                            'gameId': '$gameId',
                            'gameNumber': "$gameNumber",
                            'hall': '$hall.id'
                        },
                        'gameMode': {
                            '$first': '$gameMode'
                        },
                        'gameNumber': {
                            '$last': '$gameNumber'
                        },
                        'createdAt': {
                            '$last': '$createdAt'
                        },
                        'gameStartDate': {
                            '$first': '$gameStartDate'
                        },
                        'buyTicket': {
                            '$sum': {
                                '$cond': [
                                    {
                                        '$eq': [
                                            '$defineSlug', 'buyTicket'
                                        ]
                                    }, 1, 0
                                ]
                            }
                        },
                        'cancelTicket': {
                            '$sum': {
                                '$cond': [
                                    {
                                        '$in': [
                                            '$defineSlug', ['cancelTicket', 'refund']
                                        ]
                                    }, 1, 0
                                ]
                            }
                        },
                        'groupHall': {
                            '$last': '$groupHall'
                        },
                        'hall': {
                            '$last': '$hall'
                        },
                        'winningPrice': {
                            '$sum': '$winningPrice'
                        },
                        'ticketPrice': {
                            '$first': '$ticketPrice'
                        }
                    }
                }, {
                    '$project': {
                        'gameMode': '$gameMode',
                        'gameNumber': '$gameNumber',
                        'gameStartDate': 1,
                        'totalNumberOfTicketSold': {
                            '$subtract': [
                                '$buyTicket', '$cancelTicket'
                            ]
                        },
                        'groupHall': '$groupHall',
                        'hall': '$hall',
                        'OMS': {
                            '$multiply': [
                                '$ticketPrice', {
                                    '$subtract': [
                                        '$buyTicket', '$cancelTicket'
                                    ]
                                }
                            ]
                        },
                        'UTD': '$winningPrice'
                    }
                },
                { "$sort": sort },
            ]

            dataQuery[0]['$match']['gameStartDate'] = { $gte: startTo };
            dataQuery[0]['$match']['gameStartDate']['$lt'] = endFrom;
            if (search) {
                dataQuery[0]['$match']['gameNumber'] = { $regex: '.*' + search + '.*' }
            }

            if (hallName) {
                dataQuery[0]['$match']['hallId'] = hallName;
            }
            if (groupHall) {
                dataQuery[0]['$match']['groupHallId'] = groupHall;
            }

            console.log("++++++++++++++ dataQuery dataQuery :", JSON.stringify(dataQuery, null, 2))



            // console.log("++++++++++++++ after dataQuery dataQuery :", dataQuery)


            let data = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(dataQuery);
            let totalOMS = data.reduce((a, b) => {
                return a + b.OMS
            }, 0);
            let totalUTD = data.reduce((a, b) => {
                return a + b.UTD
            }, 0);
            //console.log("data after", data);
            var obj = {
                'draw': req.query.draw,
                'recordsTotal': data.length,
                'recordsFiltered': data.length,
                'data': data,
                'oms&utd': {
                    oms: totalOMS,
                    utd: totalUTD
                }
            };
            return res.send(obj);
        } catch (e) {
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': [],
                'oms&utd': {
                    oms: 0,
                    utd: 0
                }
            };
            console.log("Error in game 2 Report Generation", e);
            return res.send(obj);
        }
    },

    game2History: async function (req, res) {
        try {
            let keys = [
                "game_history",
                "dashboard",
                "view_tickets",
                "count_total_number_displayed",
                "total_number_displayed",
                "ticket_display",
                "winner_type",
                "win_pattern",
                "winning_amount",
                "player_name",
                "player_name_uniqueid",
                "user_type",
                "ticket_number",
                "ticket_price",
                "purcahsed_with_kr_points",
                "winning_on_jackpot_number",
                "winning_on_lucky_number",
                "total_winnings",
                "remark",
                "action",
                "real",
                "bot",
                "search",
                "reset",
                "show",
                "entries",
                "previous",
                "next",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            console.log("In Game2History ::", req.params);
            let Game = await Sys.App.Services.GameService.getSingleGameData({ gameNumber: req.params.gameId });
            let groupHall = await Sys.App.Services.GroupHallServices.getGroupHall({ _id: req.params.grpId });
            let hall = await Sys.App.Services.HallServices.getSingleHallData({ name: req.params.hallname });
            console.log("data", groupHall, hall);
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                Game: Game,
                groupHall: groupHall,
                hall: hall,
                error: req.flash("error"),
                success: req.flash("success"),
                reportgame2: 'active',
                ReportMenu: "active",
                gameReport: translate,
                navigation: translate
            };
            return res.render('report/game2History', data);
        } catch (error) {
            console.log("Error in Game 2 history page :::", error);
            return res.send("error");
        }
    },

    reportGame3: async function (req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Report Management'] || [];
                let stringReplace =req.session.details.isPermission['Report Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Report Management'];
                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            let keys = [
                "game3_report",
                "dashboard",
                "from_date",
                "to_date",
                "real",
                "bot",
                "group_of_hall_name",
                "group_of_halls",
                "child_game_id",
                "game_id",
                "hall_name",
                "search",
                "reset",
                "sub_game_id",
                "start_date_Time",
                "payout",
                "total_oms",
                "total_payout",
                "search_subgame_id",
                "show",
                "entries",
                "previous",
                "next",
                "order_from_date_alert",
                "order_to_date_alert",
                "result",
                "group_of_hall",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                reportgame3: 'active',
                ReportMenu: "active",
                gameReport: translate,
                navigation: translate
            };


            if (viewFlag) {
                return res.render('report/game3reports', data);
            } else {
                req.flash('error',await Sys.Helper.bingo.getTraslateData(["you_are_not_allowed_to_access_that_page"], req.session.details.language)) //'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in reportGame3", e);
            return new Error(e);
        }
    },

    getReportGame3: async function (req, res) {
        try {
            console.log("game 3 reorts called", JSON.stringify(req.query, null, 2));
            let order = req.query.order;
            let sort = {};
            let groupHall = req.query.groupHall;
            let hallName = req.query.hallName;
            if (req.session.details.role == 'agent') {
                hallName = req.session.details.hall[0].id;
            }
            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1,
                }
            }

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            let isBot = req.query.playerType == "bot" ? true : false; //{ $in: ["Bot"] } : { $in: ["Online","UniqueId"] };
            let startTo = new Date(req.query.start_date);
            let endFrom = new Date(req.query.end_date);
            endFrom.setHours(23, 59, 59);
            startTo.setHours(0, 0, 0);

            // {
            //     '$lookup': {
            //         'let': {
            //             'hallObjId': {
            //                 '$toObjectId': '$hallId'
            //             }
            //         },
            //         'from': 'hall',
            //         'pipeline': [
            //             {
            //                 '$match': {
            //                     '$expr': {
            //                         '$eq': [
            //                             '$_id', '$$hallObjId'
            //                         ]
            //                     }
            //                 }
            //             }, {
            //                 '$project': {
            //                     '_id': 1,
            //                     'name': 1
            //                 }
            //             }
            //         ],
            //         'as': 'hallData'
            //     }
            // }, {
            //     '$unwind': {
            //         'path': '$hallData'
            //     }
            // }, {
            //     '$lookup': {
            //         'let': {
            //             'groupHallObjId': {
            //                 '$toObjectId': '$groupHallId'
            //             }
            //         },
            //         'from': 'groupHall',
            //         'pipeline': [
            //             {
            //                 '$match': {
            //                     '$expr': {
            //                         '$eq': [
            //                             '$_id', '$$groupHallObjId'
            //                         ]
            //                     }
            //                 }
            //             }, {
            //                 '$project': {
            //                     '_id': 1,
            //                     'name': 1
            //                 }
            //             }
            //         ],
            //         'as': 'groupHallData'
            //     }
            // }, {
            //     '$unwind': {
            //         'path': '$groupHallData'
            //     }
            // }, 

            let dataQuery = [
                {
                    '$match': {
                        'gameType': 'game_3',
                        'gameStartDate': { $gte: startTo, $lt: endFrom },
                        "isBotGame": isBot,
                        '$or': [
                            {
                                'defineSlug': {
                                    '$nin': [
                                        'extraTransaction', 'leaderboard', 'loyalty'
                                    ]
                                }
                            }, {
                                'defineSlug': 'extraTransaction',
                                'typeOfTransaction': 'Revert'
                            }
                        ],
                        "groupHall": { $exists: true },
                        "hall": { $exists: true }
                    }
                },
                {
                    '$project': {
                        'gameMode': 1,
                        'gameNumber': 1,
                        'gameStartDate': 1,
                        'createdAt': 1,
                        'defineSlug': 1,
                        'groupHall': 1,
                        'hall': 1,
                        'winningPrice': 1,
                        'ticketPrice': 1,
                        'typeOfTransaction': 1,
                        'typeOfTransactionTotalAmount': 1
                    }
                },
                {
                    '$group': {
                        '_id': {
                            'gameId': '$gameId',
                            'gameNumber': "$gameNumber",
                            'hall': '$hall.id'
                        },
                        'gameMode': {
                            '$first': '$gameMode'
                        },
                        'gameNumber': {
                            '$last': '$gameNumber'
                        },
                        'createdAt': {
                            '$last': '$createdAt'
                        },
                        'gameStartDate': {
                            '$first': '$gameStartDate'
                        },
                        'buyTicket': {
                            '$sum': {
                                '$cond': [
                                    {
                                        '$eq': [
                                            '$defineSlug', 'buyTicket'
                                        ]
                                    }, 1, 0
                                ]
                            }
                        },
                        'cancelTicket': {
                            '$sum': {
                                '$cond': [
                                    {
                                        '$in': [
                                            '$defineSlug', ['cancelTicket', 'refund']
                                        ]
                                    }, 1, 0
                                ]
                            }
                        },
                        'revertAmount': {
                            '$sum': {
                                '$cond': [
                                    {
                                        '$eq': [
                                            '$typeOfTransaction', 'Revert'
                                        ]
                                    }, '$typeOfTransactionTotalAmount', 0
                                ]
                            }
                        },
                        'groupHall': {
                            '$last': '$groupHall'
                        },
                        'hall': {
                            '$last': '$hall'
                        },
                        'winningPrice': {
                            '$sum': '$winningPrice'
                        },
                        'ticketPrice': {
                            '$first': '$ticketPrice'
                        }
                    }
                }, {
                    '$project': {
                        'gameMode': '$gameMode',
                        'gameNumber': '$gameNumber',
                        'gameStartDate': 1,
                        'totalNumberOfTicketSold': {
                            '$subtract': [
                                '$buyTicket', '$cancelTicket'
                            ]
                        },
                        'groupHall': '$groupHall',
                        'hall': '$hall',
                        'OMS': {
                            '$multiply': [
                                '$ticketPrice', {
                                    '$subtract': [
                                        '$buyTicket', '$cancelTicket'
                                    ]
                                }
                            ]
                        },
                        'UTD': { '$subtract': ['$winningPrice', '$revertAmount'] }
                    }
                },
                {
                    $match: {
                        "OMS": { $gt: 0 }
                    }
                }
            ]


            if (search != '') {
                dataQuery[0]["$match"]['gameNumber'] = { $regex: '.*' + search + '.*' }
            }
            if (hallName !== '') {
                // if (tmp.length) {
                //     tmp[0]["$match"]['hall.id'] = hallName
                // } else {
                //     tmp.push({
                //         $match: {
                //             hall: { _id: await Sys.Helper.bingo.obId(hallName) }
                //         }
                //     });
                // }
                dataQuery[0]["$match"]['hall.id'] = hallName
            }
            if (groupHall !== '') {
                dataQuery[0]["$match"]['groupHall.id'] = groupHall
            }

            dataQuery.push({ $sort: sort });

            console.log("++++++++++++++ after dataQuery dataQuery :", JSON.stringify(dataQuery, null, 2))
            let data = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(dataQuery);
            let totalOMS = data.reduce((a, b) => {
                return a + b.OMS
            }, 0);
            let totalUTD = data.reduce((a, b) => {
                return a + b.UTD
            }, 0);
            //console.log("data after", data);
            var obj = {
                'draw': req.query.draw,
                'recordsTotal': data.length,
                'recordsFiltered': data.length,
                'data': data,
                'oms&utd': {
                    oms: totalOMS,
                    utd: totalUTD
                }
            };
            return res.send(obj);
        } catch (e) {
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': [],
                'oms&utd': {
                    oms: 0,
                    utd: 0
                }
            };
            console.log("Error in game 3 Report Generation", e);
            return res.send(obj);
        }
    },

    game3History: async function (req, res) {
        try {
            let keys = [
                "game_history",
                "dashboard",
                "view_tickets",
                "count_total_number_displayed",
                "total_number_displayed",
                "ticket_display",
                "winner_type",
                "win_pattern",
                "winning_amount",
                "player_name",
                "player_name_uniqueid",
                "user_type",
                "ticket_number",
                "ticket_price",
                "purcahsed_with_kr_points",
                "winning_on_jackpot_number",
                "winning_on_lucky_number",
                "total_winnings",
                "remark",
                "action",
                "real",
                "bot",
                "search",
                "reset",
                "show",
                "entries",
                "previous",
                "next",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            console.log("In Game3History ::", req.params);
            let Game = await Sys.App.Services.GameService.getSingleGameData({ gameNumber: req.params.gameId });
            let groupHall = await Sys.App.Services.GroupHallServices.getGroupHall({ _id: req.params.grpId });
            let hall = await Sys.App.Services.HallServices.getSingleHallData({ _id: req.params.hallname });
            console.log("data", groupHall, hall, Game);
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                Game: Game,
                groupHall: groupHall,
                hall: hall,
                error: req.flash("error"),
                success: req.flash("success"),
                reportgame3: 'active',
                ReportMenu: "active",
                gameReport: translate,
                navigation: translate
            };
            return res.render('report/game3History', data);
        } catch (error) {
            console.log("Error in Game 3 history page :::", error);
            return res.send("error");
        }
    },

    reportGame4: async function (req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Report Management'] || [];
                let stringReplace =req.session.details.isPermission['Report Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Report Management'];
                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            let keys = [
                "game4_report",
                "dashboard",
                "start_date",
                "end_date",
                "real",
                "bot",
                "ticket_price",
                "total_winnings",
                "net_profit",
                "profit_percentage",
                "both_date_required",
                "game_id",
                "hall_name",
                "search",
                "reset",
                "start_date_Time",
                "show",
                "entries",
                "previous",
                "next",
                "order_from_date_alert",
                "order_to_date_alert",
                "result"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                reportgame4: 'active',
                ReportMenu: "active",
                gameReport: translate,
                navigation: translate
            };

            if (viewFlag) {
                return res.render('report/game4reports', data);
            } else {
                req.flash('error',await Sys.Helper.bingo.getTraslateData(["you_are_not_allowed_to_access_that_page"], req.session.details.language)) //'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }


        } catch (e) {
            console.log("Error in reportGame4", e);
            return new Error(e);
        }
    },

    getReportGame4: async function (req, res) {
        try {
            let { order, columns, gameType, start, length, search, start_date, end_date, is_date_search, draw } = req.query;
    
            let sort = {};
            if (order?.length) {
                let columnIndex = parseInt(order[0].column);
                let sortBy = columns[columnIndex]?.data || "createdAt";
                sort[sortBy] = order[0].dir === "asc" ? 1 : -1;
            }
    
            start = parseInt(start) || 0;
            length = parseInt(length) || 10;
            search = search?.value?.trim() || "";

            // Base Query
            let query = { status: "finish" };

            // Player Type Filter
            if (gameType) {
                query["otherData.isBotGame"] = gameType !== "real";
            }

            // Date Range Filter
            if (start_date && end_date) {
                let startTo = new Date(start_date);
                let endFrom = new Date(end_date);
                endFrom.setHours(23, 59, 59);
                query.startDate = { $gte: startTo, $lt: endFrom };
            }

            // Agent Role Filter (Optimized for Array)
            if (req.session.details.role === "agent" && Array.isArray(req.session.details.hall)) {
                let hallId = req.session.details.hall[0]?.id;
                if (hallId) {
                    query["halls.id"] = hallId; // Faster than $elemMatch
                }
            }

            // Search Optimization (Using Text Index)
            if (search) {
                let escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // Escape regex special characters
                query.gameNumber = { $regex: escapedSearch, $options: "i" };
            }

            // **Optimized Query Execution**
            // 1. Fetch Total Count 
            let totalRecords = await Sys.Game.Game4.Services.GameServices.subgameCount(query);

            // 2. Fetch Paginated Data (Uses Indexing & Projection)
            let data = await Sys.Game.Game4.Services.GameServices.getSubGameData(query, { gameNumber: 1, totalEarning: 1, totalWinning: 1, finalGameProfitAmount: 1, startDate: 1, 'otherData.profitPercentage': 1 }, { sort: sort, limit: length, skip: start });
            console.log("data", data)
            res.send({
                draw,
                recordsTotal: totalRecords,
                recordsFiltered: totalRecords,
                data
            });

        } catch (e) {
            console.error("Error:", e);
            res.status(500).send({ error: "Internal Server Error" });
        }
    },


    hallSpecificReportPage: async function (req, res) {
        try {
            let keys = [
                "hall_specific_reports",
                "dashboard",
                "from_date",
                "to_date",
                "start_date",
                "end_date",
                "game_type",
                "real",
                "bot",
                "group_of_hall",
                "group_of_hall_name",
                "agent",
                "elvis_replace_amount",
                "both_date_required",
                "payout",
                "sell_product_reports",
                "customer_number",
                "cash",
                "card",
                "total",
                "date",
                "game_id",
                "hall_name",
                "search",
                "reset",
                "start_date_Time",
                "show",
                "entries",
                "previous",
                "next",
                "order_from_date_alert",
                "order_to_date_alert",
                "result"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            console.log("HallSpecificReportPage Called");
            // let groupHalls = await Sys.App.Services.GroupHallServices.getByData({},{name:1});
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                // groupHall: groupHalls,
                error: req.flash("error"),
                success: req.flash("success"),
                hallSpecificReport: 'active',
                gameReport: translate,
                navigation: translate
                //ReportMenu: "active",
            };
            if (req.session.details.role == "agent") {
                data['hallspecificReport'] = "active";
            } else {
                data['ReportMenu'] = "active";
            }
            return res.render('report/hallReport', data);
        } catch (error) {
            console.log("Error while hallSpecificReportPage render", error);
        }
    },

    getHallSpecificReport: async function (req, res) {
        try {
            console.log("request data in getHallSpecificReport", req.query);
            let order = req.query.order;
            let sort = {};
            if (order?.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1,
                }
            }

            let groupHall = req.query.groupHall;
            let hallName = req.query.hall;
            let startTo = new Date(req.query.start_date);
            let endFrom = new Date(req.query.end_date);
            endFrom = new Date(endFrom.setHours(23, 59, 59));
            startTo = new Date(startTo.setHours(0, 0, 0));

            if (req.session.details.role == "agent") {
                hallName = req.session.details.hall[0].id;
            }
            // let dataQuery = [{
            //         $match: {
            //             gameType: "game_2",
            //         }
            //     },
            //     {
            //         $lookup: {
            //             from: 'game',
            //             localField: 'gameNumber',
            //             foreignField: 'gameNumber',
            //             as: 'gameData'
            //         }
            //     },
            //     {
            //         $unwind: "$gameData"
            //     },
            //     {
            //         $group: {
            //             _id:{ gameId: '$gameId', hallName: '$hall.name' },
            //             gameMode: { $first: '$gameMode' },
            //             gameNumber: { $last: '$gameNumber' },
            //             createdAt: { $last: '$createdAt' },
            //             gameStartDate: { $last: '$gameStartDate' },
            //             totalNumberOfTicketSold: { $last: { $size: "$gameData.purchasedTickets" } },
            //             groupHall: {$last: "$groupHall"},
            //             hall: { $last: "$hall.name" },
            //             totalNumberEarned: {
            //                 $last: {
            //                     $sum: {
            //                         $sum: '$gameData.purchasedTickets.totalAmount'
            //                     }
            //                 }
            //             },
            //             winningPrice: { "$sum": '$winningPrice' },

            //         }
            //     },
            //     // {
            //     //     $addFields: {
            //     //         netProfit: { $subtract: ['$totalNumberEarned', '$winningPrice'] }
            //     //     }
            //     // },
            //     {
            //         $project: {
            //             gameMode: "$gameMode",
            //             gameNumber: "$gameNumber",
            //             // createdAt: '$createdAt',
            //             gameStartDate: 1,
            //             totalNumberOfTicketSold: "$totalNumberOfTicketSold",
            //             groupHall: "$groupHall",
            //             hall: "$hall",
            //             OMS: '$totalNumberEarned',
            //             UTD: '$winningPrice',
            //             // RES: '$netProfit',
            //             // payout: {
            //             //     $cond: {
            //             //         if: {
            //             //             $and: [{ $gt: ["$netProfit", 0] }, { $gt: ["$winningPrice", 0] }]
            //             //         },
            //             //         then: {
            //             //             "$concat": [{ "$substr": [{ "$divide": [{ "$multiply": ['$netProfit', 100] }, '$totalNumberEarned'] }, 0, 4] }, "", "%"]
            //             //         },
            //             //         else: {
            //             //             $cond: {
            //             //                 if: { $gt: ["$netProfit", 0] },
            //             //                 then: {
            //             //                     "$concat": [{ "$substr": [{ "$divide": [{ "$multiply": ['$netProfit', 100] }, '$netProfit'] }, 0, 4] }, "", "%"]
            //             //                 },
            //             //                 else: {
            //             //                     "$concat": ["0", "", "%"]
            //             //                 }
            //             //             }
            //             //         }
            //             //     }
            //             // },
            //         }
            //         // $project: {
            //         //     gameMode: "$gameMode",
            //         //     gameNumber: "$gameNumber",
            //         //     createdAt: '$createdAt',
            //         //     gameStartDate: 1,
            //         //     totalNumberOfTicketSold: "$totalNumberOfTicketSold",
            //         //     totalNumberEarned: '$totalNumberEarned',
            //         //     totalWinning: '$winningPrice',
            //         //     netProfit: '$netProfit',
            //         //     profitPercentage: {
            //         //         $cond: {
            //         //             if: {
            //         //                 $and: [{ $gt: ["$netProfit", 0] }, { $gt: ["$winningPrice", 0] }]
            //         //             },
            //         //             then: {
            //         //                 "$concat": [{ "$substr": [{ "$divide": [{ "$multiply": ['$netProfit', 100] }, '$totalNumberEarned'] }, 0, 4] }, "", "%"]
            //         //             },
            //         //             else: {
            //         //                 $cond: {
            //         //                     if: { $gt: ["$netProfit", 0] },
            //         //                     then: {
            //         //                         "$concat": [{ "$substr": [{ "$divide": [{ "$multiply": ['$netProfit', 100] }, '$netProfit'] }, 0, 4] }, "", "%"]
            //         //                     },
            //         //                     else: {
            //         //                         "$concat": ["0", "", "%"]
            //         //                     }
            //         //                 }
            //         //             }
            //         //         }
            //         //     },
            //         // }
            //     }
            // ];

            let isBotGame = false;
            if (req.query.playerType == "bot") {
                isBotGame = true
            }

            let dataQuery = [
                {
                    '$match': {
                        "hallId": { "$exists": true },
                        "groupHallId": { $ne: "" },
                        "defineSlug": { "$nin": ["loyalty", "leaderboard"] },
                        "isBotGame": isBotGame,
                        "gameType": {
                            "$exists": true,
                            "$ne": ""
                        }
                    }
                }, {
                    '$group': {
                        '_id': {
                            'groupHallId': '$groupHallId',
                            'hallId': '$hallId',
                            'gameType': '$gameType'
                        },
                        'buyTicket': {
                            '$sum': {
                                '$cond': [
                                    {
                                        '$or': [
                                            // {
                                            //     '$eq': [
                                            //         '$game1Slug', 'replaceTicket'
                                            //     ]
                                            // },
                                            {
                                                '$eq': [
                                                    '$game1Slug', 'buyTicket'
                                                ]
                                            }, {
                                                '$eq': [
                                                    '$defineSlug', 'buyTicket'
                                                ]
                                            },
                                            {
                                                $and: [{ '$eq': ['$gameType', 'game_5'] }, { '$eq': ['$typeOfTransaction', 'Game Joined'] }]

                                            }
                                        ]
                                    }, '$typeOfTransactionTotalAmount', 0
                                ]
                            }
                        },
                        'cancelTicket': {
                            '$sum': {
                                '$cond': [
                                    {
                                        '$or': [
                                            {
                                                '$eq': [
                                                    '$game1Slug', 'cancelTicket'
                                                ]
                                            }, {
                                                '$in': [
                                                    '$defineSlug', ['cancelTicket', 'refund']
                                                ]
                                            }
                                        ]
                                    }, '$typeOfTransactionTotalAmount', 0
                                ]
                            }
                        },
                        'UTD': {
                            '$sum': '$winningPrice'
                        },
                        'elvis_replace_amount': {
                            '$sum': {
                                '$cond': [
                                    {
                                        '$or': [
                                            {
                                                '$eq': [
                                                    '$game1Slug', 'replaceTicket'
                                                ]
                                            }
                                        ]
                                    }, '$typeOfTransactionTotalAmount', 0
                                ]
                            }
                        }
                    }
                }, {
                    '$addFields': {
                        'OMS': {
                            '$subtract': [
                                '$buyTicket', '$cancelTicket'
                            ]
                        }
                    }
                }, {
                    '$group': {
                        '_id': {
                            'hallId': '$_id.hallId',
                            'groupHallId': '$_id.groupHallId'
                        },
                        'transactions': {
                            '$push': {
                                'k': '$_id.gameType',
                                'v': {
                                    'OMS': '$OMS',
                                    'UTD': '$UTD',
                                    'elvis_replace_amount': '$elvis_replace_amount'
                                }
                            }
                        }
                    }
                }, {
                    '$addFields': {
                        '_id': '$_id',
                        'gameData': {
                            '$arrayToObject': '$transactions'
                        }
                    }
                }, {
                    '$lookup': {
                        'let': {
                            'hallObjId': {
                                '$toObjectId': '$_id.hallId'
                            }
                        },
                        'from': 'hall',
                        'pipeline': [
                            {
                                '$match': {
                                    '$expr': {
                                        '$eq': [
                                            '$_id', '$$hallObjId'
                                        ]
                                    }
                                }
                            }, {
                                '$project': {
                                    '_id': -1,
                                    'name': 1,
                                    'agents': 1,
                                    'groupHall': 1
                                }
                            }
                        ],
                        'as': 'hall'
                    }
                }, {
                    '$unwind': {
                        'path': '$hall'
                    }
                }, {
                    '$project': {
                        'hallid': '$hall._id',
                        'hallName': '$hall.name',
                        'agents': '$hall.agents',
                        'groupId': '$hall.groupHall.id',
                        'groupName': '$hall.groupHall.name',
                        'gameData': 1,
                        '_id': 0
                    }
                }
            ]

            dataQuery[0]['$match']['createdAt'] = { $gte: startTo };
            dataQuery[0]['$match']['createdAt']['$lt'] = endFrom;
            if (hallName) {
                dataQuery[0]['$match']['hallId'] = hallName;
            }
            if (groupHall) {
                dataQuery[0]['$match']['groupHallId'] = groupHall;
            }



            console.log("++++++++++++++ dataQuery dataQuery :", JSON.stringify(dataQuery))



            console.log("++++++++++++++ after dataQuery dataQuery :", dataQuery)


            let data = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(dataQuery);

            for (let i = 0; i < data.length; i++) {
                if (data[i]["gameData"]['game_1']) {
                    data[i].game1 = data[i]["gameData"]['game_1']
                } else {
                    data[i].game1 = {
                        OMS: 0,
                        UTD: 0
                    }
                }
                if (data[i]["gameData"]['game_2']) {
                    data[i].game2 = data[i]["gameData"]['game_2']
                } else {
                    data[i].game2 = {
                        OMS: 0,
                        UTD: 0
                    }
                }
                if (data[i]["gameData"]['game_3']) {
                    data[i].game3 = data[i]["gameData"]['game_3']
                } else {
                    data[i].game3 = {
                        OMS: 0,
                        UTD: 0
                    }
                }
                if (data[i]["gameData"]['game_4']) {
                    data[i].game4 = data[i]["gameData"]['game_4']
                } else {
                    data[i].game4 = {
                        OMS: 0,
                        UTD: 0
                    }
                }
                if (data[i]["gameData"]['game_5']) {
                    data[i].game5 = data[i]["gameData"]['game_5']
                } else {
                    data[i].game5 = {
                        OMS: 0,
                        UTD: 0
                    }
                }
                delete data[i]["gameData"];
            }
            //console.log("data after", data);
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': data.length,
                'recordsFiltered': data.length,
                'data': data
            };
            return res.send(obj);
        } catch (e) {
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            };
            console.log("Error in game 2 Report Generation", e);
            return res.send(obj);
        }
    },

    reportGame5: async function (req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Report Management'] || [];
                let stringReplace =req.session.details.isPermission['Report Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Report Management'];
                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            let keys = [
                "game5_report",
                "dashboard",
                "start_date",
                "end_date",
                "real",
                "bot",
                "total_bet",
                "ticket_price",
                "winning_pattern",
                "total_winnings",
                "net_profit",
                "profit_percentage",
                "both_date_required",
                "game_id",
                "hall_name",
                "search",
                "reset",
                "start_date_Time",
                "show",
                "entries",
                "previous",
                "next",
                "order_from_date_alert",
                "order_to_date_alert",
                "result"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                reportgame5: 'active',
                ReportMenu: "active",
                gameReport: translate,
                navigation: translate
            };

            if (viewFlag) {
                return res.render('report/game5reports', data);
            } else {
                req.flash('error',await Sys.Helper.bingo.getTraslateData(["you_are_not_allowed_to_access_that_page"], req.session.details.language)) //'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in reportGame5", e);
            return new Error(e);
        }
    },

    getReportGame5: async function (req, res) {
        try {

            let order = req.query.order;
            let sort = { "createdAt": -1 };
            if (order && order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1,
                }
            }

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let startTo = new Date(req.query.start_date);
            let endFrom = new Date(req.query.end_date);
            endFrom.setHours(23, 59, 59);
            console.log("req.query.start_date", req.query.start_date);
            console.log("req.query.end_date", req.query.end_date);
            console.log("startTo", startTo);
            console.log("endFrom", endFrom);

            let query = { status: "Finished" };
            if (search != '') {
                query.gameNumber = { $regex: `.*${search}.*`, $options: 'i' }
            }

            if (req.query.start_date && req.query.end_date) {
                query.startDate = { $gte: startTo, $lt: endFrom }
            }

            if (req.query.playerType == "bot") {
                query['otherData.isBotGame'] = true;
            } else {
                query['otherData.isBotGame'] = false;
            }
            console.log("query--", query, req.query.playerType)
            let reqCount = await Sys.Game.Game5.Services.GameServices.getSubgameCount(query);

            let data = await Sys.Game.Game5.Services.GameServices.getSubgameByData(query, { gameNumber: 1, earnedFromTickets: 1, totalWinning: 1, finalGameProfitAmount: 1, startDate: 1, winners: 1 }, { sort: sort, limit: length, skip: start });

            let gameStats = await Sys.Game.Game5.Services.GameServices.aggregateSubgameQuery([
                {
                    $match: query
                },
                {
                    $group: {
                        _id: null,
                        totalBets: { $sum: "$earnedFromTickets" },
                        totalWinnings: { $sum: "$totalWinning" },
                        totalProfit: { $sum: "$finalGameProfitAmount" }
                    }
                }
            ]);
            console.log("gameStats---", gameStats)
            let totalOMS = 0;
            let totalUTD = 0;
            let totalProfit = 0;
            if (gameStats.length > 0) {
                totalOMS = gameStats[0].totalBets;
                totalUTD = gameStats[0].totalWinnings;
                totalProfit = gameStats[0].totalProfit;
            }

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
                'oms&utd': {
                    oms: totalOMS,
                    utd: totalUTD,
                    totalProfit: totalProfit
                }
            };

            /*let dataQuery = [
                {
                    $project: {
                        gameNumber:1,
                        earnedFromTickets:1,
                        totalWinning:1,
                        finalGameProfitAmount: 1,
                        startDate: 1,
                        profitPercentage: {
                            $cond: {
                                if: {
                                    $gt: ['$totalWinning', 0]
                                },
                                then: {
                                    $divide:[{$multiply:["$finalGameProfitAmount",100]}, "$earnedFromTickets"],
                                },
                                else: 100
                            }
                        }
                    }
                }
                
            ]

            let tmp1 = [
                { $limit: start + length },
                { $skip: parseInt(start) },
                { $sort: sort },
            ];
            let tmp = [];
            if (search) {
                tmp.push({ $match: { 'gameNumber': { $regex: '.*' + search + '.*' } } });
            }

            if (req.query.is_date_search == "yes" && search == '') {
                tmp.push({ $match: { startDate: { $gte: startTo, $lt: endFrom } } });
            }

            if (req.query.is_date_search == "yes" && search != '') {
                tmp.push({
                    $match: {
                        'gameNumber': { $regex: '.*' + search + '.*' },
                        startDate: { $gte: startTo, $lt: endFrom }
                    }
                });
            }

            if (tmp.length > 0) {
                dataQuery = dataQuery.concat(tmp);
            }

            let dataCntt =  await Sys.Game.Game5.Services.GameServices.aggregateSubgameQuery(dataQuery)

            if (tmp1.length > 0) {
                dataQuery = dataQuery.concat(tmp1);
            }
            console.log("data query", JSON.stringify(dataQuery))
            let data =  await Sys.Game.Game5.Services.GameServices.aggregateSubgameQuery(dataQuery);

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': dataCntt.length,
                'recordsFiltered': dataCntt.length,
                'data': data,
            };*/

            res.send(obj);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getHallSpecificOrderReport: async function (req, res) {
        try {
            console.log("request data in getHallSpecificReport", req.query);
            let order = req.query.order;
            let sort = {};
            if (order?.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1,
                }
            }

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);

            let groupHall = req.query.groupHall;
            let hallName = req.query.hall;
            let startTo = new Date(req.query.start_date);
            let endFrom = new Date(req.query.end_date);
            endFrom = new Date(endFrom.setHours(23, 59, 59));
            startTo = new Date(startTo.setHours(0, 0, 0));

            if (req.session.details.role == "agent") {
                hallName = req.session.details.hall[0].id;
            }

            const dataQuery = [
                {
                    $match: {
                        createdAt: { $gte: startTo, $lt: endFrom }
                    }
                },

                // {
                //     $unwind: "$productList"
                // },

                // {
                //     $addFields: {
                //         "productList.quantity": { $toDouble: "$productList.quantity" },
                //         "productList.price": { $toDouble: "$productList.price" }
                //     }
                // },

                // {
                //     $group: {
                //         _id: { shiftId: "$shiftId", paymentMethod: "$paymentMethod" },
                //         totalCash: {
                //             $sum: {
                //                 $cond: [{ $eq: ["$paymentMethod", "Cash"] }, "$totalAmount", 0]
                //             }
                //         },
                //         totalCard: {
                //             $sum: {
                //                 $cond: [{ $eq: ["$paymentMethod", "Card"] }, "$totalAmount", 0]
                //             }
                //         },
                //         totalCustomerNumber: {
                //             $sum: {
                //                 $cond: [{ $eq: ["$paymentMethod", "customerNumber"] }, "$totalAmount", 0]
                //             }
                //         },
                //         totalAmount: { $sum: "$totalAmount" },
                //         date: { $first: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } } },
                //         groupHallName: { $first: "$groupHallName" }, 
                //         hallName: { $first: "$hallName" }
                //     }
                // },
                // {
                //     $group: {
                //         _id: "$_id.shiftId",
                //         cashTotal: { $sum: "$totalCash" },
                //         cardTotal: { $sum: "$totalCard" },
                //         totalCustomerNumber: { $sum: "$totalCustomerNumber" },
                //         totalDay: { $sum: "$totalAmount" },
                //         date: { $first: "$date" },
                //         groupHallName: { $first: "$groupHallName" },
                //         hallName: { $first: "$hallName" }
                //     }
                // },

                {
                    $group: {
                        _id: {
                            shiftId: "$shiftId",
                            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                            groupHallName: "$groupHallName",
                            hallName: "$hallName",
                            agentName: "$agentName",
                            // productId: "$productList.productId",
                            // productName: "$productList.name"
                        },
                        cashTotal: {
                            $sum: {
                                $cond: [{ $eq: ["$paymentMethod", "Cash"] }, "$totalAmount", 0]
                            }
                        },
                        cardTotal: {
                            $sum: {
                                $cond: [{ $eq: ["$paymentMethod", "Card"] }, "$totalAmount", 0]
                            }
                        },
                        customerNumberTotal: {
                            $sum: {
                                $cond: [{ $eq: ["$paymentMethod", "customerNumber"] }, "$totalAmount", 0]
                            }
                        },
                        totalAmount: { $sum: "$totalAmount" },
                        //productQuantity: { $sum: "$productList.quantity" },
                        //productPrice: { $sum: { $multiply: ["$productList.quantity", "$productList.price"] } }
                    }
                },

                {
                    $project: {
                        _id: 0,
                        date: "$_id.date",
                        groupHallName: "$_id.groupHallName",
                        hallName: "$_id.hallName",
                        shiftId: "$_id.shiftId",
                        agentName: "$_id.agentName",
                        cash: "$cashTotal",
                        card: "$cardTotal",
                        customerNumber: "$customerNumberTotal",
                        total: "$totalAmount"
                    }
                },
                {
                    $facet: {
                        metadata: [
                            {
                                $count: "totalCount"
                            }
                        ],
                        data: [
                            { $sort: { date: -1, shiftId: -1 } },
                            { $skip: start },
                            { $limit: length }
                        ],

                    }
                },
                {
                    $project: {
                        data: 1,
                        recordsTotal: { $arrayElemAt: ["$metadata.totalCount", 0] },
                        recordsFiltered: { $arrayElemAt: ["$metadata.totalCount", 0] }
                    }
                }
                // {
                //     $sort: { date: -1, shiftId: -1 }
                // },
                // {
                //     $skip: start 
                // },
                // {
                //     $limit: length 
                // }
            ];

            if (hallName) {
                dataQuery[0]['$match']['hallId'] = mongoose.Types.ObjectId(hallName);
            }
            if (groupHall) {
                dataQuery[0]['$match']['groupHallId'] = mongoose.Types.ObjectId(groupHall);
            }
            let data = await Sys.App.Services.ProductServices.getCartAggregationData(dataQuery);
            console.log("data--", JSON.stringify(data), dataQuery)
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': data[0].recordsTotal || 0,
                'recordsFiltered': data[0].recordsFiltered || 0,
                'data': data[0].data || []
            };
            return res.send(obj);
        } catch (e) {
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            };
            console.log("Error in game 2 Report Generation", e);
            return res.send(obj);
        }
    },

    totalRevenueReport: async function (req, res) {
        try {
            let viewFlag = true;
            if (!req.session.details.isSuperAdmin) {
                let stringReplace = req.session.details.isPermission['Report Management'] || [];
                if (!stringReplace.length) {
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language);
                    req.flash('error', translate.no_permission);
                    return res.redirect('/dashboard');
                }
                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }

            let keys = [
                "total_revenue_report",
                "dashboard",
                "from_date",
                "to_date",
                "date",
                "hall_name",
                "group_of_hall_name",
                "game_type",
                "real",
                "bot",
                "game",
                "total_revenue",
                "price_payout",
                "net_revenue",
                "both_date_required",
                "no_data_available_in_table",
                "showing",
                "search",
                "reset",
                "show",
                "entries",
                "previous",
                "next",
                "order_from_date_alert",
                "order_to_date_alert",
                "result",
                "all"
            ];

            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            let halls = [];
            if (req.session.details.role == 'admin') {
                let hallList = await Sys.App.Services.HallServices.getAllHallDataSelect({}, { name: 1, id: 1 });
                halls = hallList.map(h => {
                    return {
                        id: h.id || (h._id ? h._id.toString() : ""),
                        name: h.name
                    }
                });
            } else if (req.session.details.hall && req.session.details.hall.length) {
                halls = req.session.details.hall.map(h => ({ id: h.id, name: h.name }));
            }

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                ReportMenu: "active",
                reportTotalRevenue: "active",
                gameReport: translate,
                navigation: translate,
                halls: halls
            };

            if (viewFlag) {
                return res.render('report/totalRevenueReport', data);
            } else {
                req.flash('error', await Sys.Helper.bingo.getTraslateData(["you_are_not_allowed_to_access_that_page"], req.session.details.language));
                return res.redirect('/dashboard');
            }
        } catch (e) {
            console.log("Error in totalRevenueReport", e);
            return new Error(e);
        }
    },

    getTotalRevenueReport: async function (req, res) {
        try {
            let { order = [], columns = [], start = 0, length = 10, draw } = req.query;
            start = parseInt(start) || 0;
            length = parseInt(length) || 10;
    
            let startDate = req.query.start_date;
            let endDate = req.query.end_date;
            let groupHall = req.query.groupHall || "";
            let hall = req.query.hall || "";
    
            if (req.session.details.role === 'agent') {
                hall = req.session.details.hall?.[0]?.id || "";
            }
    
            if (!startDate || !endDate) {
                return res.send({
                    draw,
                    recordsTotal: 0,
                    recordsFiltered: 0,
                    data: [],
                    totals: { totalRevenue: 0, totalPayout: 0, totalNet: 0 }
                });
            }
    
            /* ---------- SORT ---------- */
            const allowedSort = ['date', 'revenue', 'payout', 'net'];
            let sortField = 'date';
            let sortDir = -1;
    
            if (order?.length) {
                const col = columns?.[order[0].column]?.data;
                if (allowedSort.includes(col)) {
                    sortField = col;
                    sortDir = order[0].dir === 'asc' ? 1 : -1;
                }
            }
    
            let sort = { [sortField]: sortDir };
    
            /* ---------- DATE RANGE ---------- */
            let startTo = new Date(startDate);
            let endFrom = new Date(endDate);
            startTo.setHours(0, 0, 0, 0);
            endFrom.setHours(23, 59, 59, 999);
    
            /* ---------- MATCH ---------- */
            let match = {
                gameType: { $exists: true, $ne: "" },
                isBotGame: false,
                createdAt: { $gte: startTo, $lt: endFrom },
                defineSlug: { $nin: ['loyalty', 'leaderboard'] },
            };
    
            if (hall) match.hallId = hall;
            
            const pipeline = [
                { $match: match },
    
                {
                    $addFields: {
                        day: { $dateTrunc: { date: "$createdAt", unit: "day" } },
    
                        isRevenue: {
                            $or: [
                                { $in: ['$game1Slug', ['buyTicket', 'replaceTicket']] },
                                { $eq: ['$defineSlug', 'buyTicket'] },
                                {
                                    $and: [
                                        { $eq: ['$gameType', 'game_5'] },
                                        { $eq: ['$typeOfTransaction', 'Game Joined'] }
                                    ]
                                }
                            ]
                        },
    
                        isCancel: {
                            $or: [
                                { $in: ['$game1Slug', ['cancelTicket', 'refund']] },
                                { $in: ['$defineSlug', ['cancelTicket', 'refund']] },
                                {
                                    $and: [
                                        { $eq: ['$gameType', 'game_5'] },
                                        { $eq: ['$typeOfTransaction', 'Cancel Ticket'] }
                                    ]
                                }
                            ]
                        }
                    }
                },
    
                {
                    $group: {
                        _id: "$day",
                        revenue: {
                            $sum: {
                                $cond: [
                                    "$isRevenue",
                                    "$typeOfTransactionTotalAmount",
                                    {
                                        $cond: [
                                            "$isCancel",
                                            { $multiply: ["$typeOfTransactionTotalAmount", -1] },
                                            0
                                        ]
                                    }
                                ]
                            }
                        },
                        payout: { $sum: "$winningPrice" }
                    }
                },
    
                {
                    $project: {
                        _id: 0,
                        date: { $dateToString: { format: "%Y-%m-%d", date: "$_id" } },
                        revenue: 1,
                        payout: 1
                    }
                },
    
                {
                    $addFields: {
                        net: { $subtract: ["$revenue", "$payout"] }
                    }
                },
    
                {
                    $match: {
                        $or: [
                            { revenue: { $ne: 0 } },
                            { payout: { $ne: 0 } },
                            { net: { $ne: 0 } }
                        ]
                    }
                },
    
                { $sort: sort },
    
                {
                    $facet: {
                        rows: [
                            { $skip: start },
                            { $limit: length }
                        ],
                        totals: [
                            {
                                $group: {
                                    _id: null,
                                    totalRevenue: { $sum: "$revenue" },
                                    totalPayout: { $sum: "$payout" },
                                    totalNet: { $sum: "$net" }
                                }
                            }
                        ],
                        totalCount: [{ $count: "count" }]
                    }
                },
    
                {
                    $project: {
                        data: "$rows",
                        totals: {
                            $ifNull: [
                                { $arrayElemAt: ["$totals", 0] },
                                { totalRevenue: 0, totalPayout: 0, totalNet: 0 }
                            ]
                        },
                        recordsTotal: { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] },
                        recordsFiltered: { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] }
                    }
                }
            ];
    
            const result = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(pipeline);
            const payload = result?.[0] || {};
    
            return res.send({
                draw,
                recordsTotal: payload.recordsTotal || 0,
                recordsFiltered: payload.recordsFiltered || 0,
                data: payload.data || [],
                totals: payload.totals || { totalRevenue: 0, totalPayout: 0, totalNet: 0 }
            });
    
        } catch (e) {
            console.log("Error in getTotalRevenueReport", e);
            return res.send({
                draw: req.query.draw,
                recordsTotal: 0,
                recordsFiltered: 0,
                data: [],
                totals: { totalRevenue: 0, totalPayout: 0, totalNet: 0 }
            });
        }
    }
    
}


// let gamesData = await Sys.App.Services.GameService.getGameData({ gameType: "game_2" });
// let transactionsData = await Sys.App.Services.PlayerServices.getByTransactionData({ gameType: "game_2" });

// let arrOfData = [];
// for (let i = 0; i < gamesData.length; i++) {

//     if (gamesData[i].purchasedTickets.length == 0) {
//         continue;
//     }

//     let saveObj = {};
//     let totalWinning = 0;

//     saveObj = {
//         _id: gamesData[i]._id,
//         gameStartDate: gamesData[i].startDate,
//         gameMode: gamesData[i].gameMode,
//         gameNumber: gamesData[i].gameNumber,
//         createdAt: gamesData[i].createdAt,
//         totalNumberOfTicketSold: gamesData[i].purchasedTickets.length,
//         totalNumberEarned: gamesData[i].purchasedTickets.reduce((n, { totalAmount }) => n + totalAmount, 0)
//     }

//     for (let j = 0; j < transactionsData.length; j++) {
//         if (JSON.stringify(gamesData[i]._id) == JSON.stringify(transactionsData[j].gameId)) {
//             if (transactionsData[j].defineSlug == "winJackpot" || transactionsData[j].defineSlug == "luckyPrize") {
//                 totalWinning += transactionsData[j].winningPrice;
//             }
//         }
//     }

//     saveObj.totalWinning = totalWinning;
//     saveObj.netProfit = saveObj.totalNumberEarned - totalWinning;
//     saveObj.profitPercentage = ((saveObj.netProfit * 100) / saveObj.totalNumberEarned).toFixed(2);
//     arrOfData.push(saveObj);

// }

// function limit(c) {
//     return this.filter((x, i) => {
//         if (i <= (c - 1)) { return true }
//     })
// }

// Array.prototype.limit = limit;

// function skip(c) {
//     return this.filter((x, i) => {
//         if (i > (c - 1)) { return true }
//     })
// }

// Array.prototype.skip = skip;


// function compareValues(key, order = 'asc') {
//     return function innerSort(a, b) {
//         if (!a.hasOwnProperty(key) || !b.hasOwnProperty(key)) {
//             // property doesn't exist on either object
//             return 0;
//         }

//         const varA = (typeof a[key] === 'string') ?
//             a[key].toUpperCase() : a[key];
//         const varB = (typeof b[key] === 'string') ?
//             b[key].toUpperCase() : b[key];

//         let comparison = 0;
//         if (varA > varB) {
//             comparison = 1;
//         } else if (varA < varB) {
//             comparison = -1;
//         }
//         return (
//             (order === 'desc') ? (comparison * -1) : comparison
//         );
//     };
// }

// let keyData = Object.keys(sort);
// let valueData = Object.values(sort);

// if (valueData[0] == 1) {
//     arrOfData.sort(compareValues(keyData));
// } else if (valueData[0] == -1) {
//     arrOfData.sort(compareValues(keyData, 'desc'));
// }

// let filtered;
// let condition = new RegExp(search);

// if (req.query.is_date_search == "yes" && search == '') {

//     filtered = arrOfData.filter(function(el) {
//         return (el.createdAt >= startTo && el.createdAt < endFrom);
//     }).skip(start).limit(length);

// } else if (req.query.is_date_search == "yes" && search != '') {

//     filtered = arrOfData.filter(function(el) {
//         return (condition.test(el.gameNumber) && el.createdAt >= startTo && el.createdAt < endFrom);
//     }).skip(start).limit(length);

// } else {

//     filtered = arrOfData.filter(function(el) {
//         return condition.test(el.gameNumber);
//     }).skip(start).limit(length);

// }